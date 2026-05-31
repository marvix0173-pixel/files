from flask import Flask, request, jsonify, render_template, session
from dotenv import load_dotenv
load_dotenv()   
import google.generativeai as genai
import os
import PyPDF2
import io
import json
import uuid

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "interview-bot-secret-2024")

# Configure Gemini
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
genai.configure(api_key=GEMINI_API_KEY)

# In-memory session store (for production use Redis/DB)
sessions = {}

def extract_pdf_text(pdf_bytes):
    """Extract text from PDF bytes"""
    try:
        reader = PyPDF2.PdfReader(io.BytesIO(pdf_bytes))
        text = ""
        for page in reader.pages:
            text += page.extract_text() + "\n"
        return text.strip()
    except Exception as e:
        return f"[無法解析 PDF: {str(e)}]"

def build_system_prompt(jd_text, resume_text):
    """Build the interviewer system prompt"""
    return f"""你是一位專業且經驗豐富的面試官，正在進行一場正式的求職面試。

## 職位描述 (JD)
{jd_text}

## 應聘者履歷
{resume_text}

## 你的角色與行為準則
1. **扮演面試官**：你代表該公司進行面試，態度專業、友善但具挑戰性
2. **問題策略**：
   - 根據 JD 要求與應聘者履歷設計針對性問題
   - 混合行為面試問題（STAR 方法）、技術問題、情境題
   - 逐步深入，從基礎到進階
   - 每次只問一個問題，等待回答後再繼續
3. **追問技巧**：若回答不夠具體或完整，適時追問細節
4. **面試流程**：
   - 開場：簡短自我介紹公司與職位，請應聘者自我介紹
   - 中段：深入詢問工作經驗、技能、專案
   - 後段：詢問動機、職涯規劃、薪資期望
   - 結尾：詢問是否有問題要問面試官
5. **語言**：使用繁體中文進行面試，除非應聘者用英文回答
6. **即時回饋**：在面試過程中可給予簡短回應（如「很好」、「有趣的觀點」），讓對話自然流暢
7. **不要**：不要破壞角色，不要直接告訴應聘者答案，不要跳出面試情境

現在，請開始這場面試。"""

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/start", methods=["POST"])
def start_interview():
    """Initialize a new interview session"""
    try:
        jd_text = request.form.get("jd_text", "").strip()
        resume_file = request.files.get("resume_pdf")

        if not jd_text:
            return jsonify({"error": "請提供職位描述 (JD)"}), 400

        resume_text = ""
        if resume_file and resume_file.filename:
            pdf_bytes = resume_file.read()
            resume_text = extract_pdf_text(pdf_bytes)
        else:
            resume_text = request.form.get("resume_text", "").strip()

        if not resume_text:
            return jsonify({"error": "請上傳履歷 PDF 或輸入履歷文字"}), 400

        # Create session
        session_id = str(uuid.uuid4())
        system_prompt = build_system_prompt(jd_text, resume_text)

        # Initialize Gemini model
        model = genai.GenerativeModel(
            model_name="gemini-2.5-flash",
            system_instruction=system_prompt
        )

        # Start chat and get opening message
        chat = model.start_chat(history=[])
        response = chat.send_message("請開始面試。")

        opening_message = response.text

        # Store session data
        sessions[session_id] = {
            "jd_text": jd_text,
            "resume_text": resume_text,
            "system_prompt": system_prompt,
            "history": [
                {"role": "user", "parts": ["請開始面試。"]},
                {"role": "model", "parts": [opening_message]}
            ],
            "message_count": 1
        }

        return jsonify({
            "session_id": session_id,
            "message": opening_message
        })

    except Exception as e:
        return jsonify({"error": f"啟動面試失敗：{str(e)}"}), 500

@app.route("/api/chat", methods=["POST"])
def chat():
    """Send a message in the interview"""
    try:
        data = request.get_json()
        session_id = data.get("session_id")
        user_message = data.get("message", "").strip()

        if not session_id or session_id not in sessions:
            return jsonify({"error": "無效的面試 Session，請重新開始"}), 400

        if not user_message:
            return jsonify({"error": "請輸入回答"}), 400

        sess = sessions[session_id]

        # Rebuild chat with history
        model = genai.GenerativeModel(
            model_name="gemini-2.5-flash",
            system_instruction=sess["system_prompt"]
        )

        chat_session = model.start_chat(history=sess["history"])
        response = chat_session.send_message(user_message)
        ai_message = response.text

        # Update history
        sess["history"].append({"role": "user", "parts": [user_message]})
        sess["history"].append({"role": "model", "parts": [ai_message]})
        sess["message_count"] += 1

        return jsonify({
            "message": ai_message,
            "message_count": sess["message_count"]
        })

    except Exception as e:
        return jsonify({"error": f"回應失敗：{str(e)}"}), 500

@app.route("/api/feedback", methods=["POST"])
def get_feedback():
    """Get overall interview feedback"""
    try:
        data = request.get_json()
        session_id = data.get("session_id")

        if not session_id or session_id not in sessions:
            return jsonify({"error": "無效的面試 Session"}), 400

        sess = sessions[session_id]

        if sess["message_count"] < 3:
            return jsonify({"error": "面試對話太少，請多練習後再查看評估"}), 400

        # Build conversation transcript
        transcript = ""
        history = sess["history"]
        for i, msg in enumerate(history):
            if msg["role"] == "user" and i > 0:  # Skip first "start" message
                transcript += f"應聘者：{msg['parts'][0]}\n\n"
            elif msg["role"] == "model" and i > 1:
                transcript += f"面試官：{msg['parts'][0]}\n\n"

        feedback_prompt = f"""根據以下面試對話，請以繁體中文提供詳細的面試表現評估報告。

職位描述重點：
{sess['jd_text'][:500]}

面試對話記錄：
{transcript[:3000]}

請提供以下格式的評估：

## 📊 整體表現評分
（請給出 1-10 分並說明理由）

## ✅ 表現亮點
（列出 3-5 個做得好的地方）

## ⚠️ 待改進之處
（列出 3-5 個可以改善的地方，並給出具體建議）

## 💡 關鍵建議
（提供 2-3 個最重要的改進方向）

## 🎯 錄取可能性評估
（根據回答品質與職位要求，評估錄取機率與原因）"""

        model = genai.GenerativeModel(model_name="gemini-2.5-flash")
        response = model.generate_content(feedback_prompt)

        return jsonify({"feedback": response.text})

    except Exception as e:
        return jsonify({"error": f"生成評估失敗：{str(e)}"}), 500

@app.route("/api/end", methods=["POST"])
def end_interview():
    """End and clean up the interview session"""
    try:
        data = request.get_json()
        session_id = data.get("session_id")
        if session_id and session_id in sessions:
            del sessions[session_id]
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

import os

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))

    app.run(
        host="0.0.0.0",
        port=port
    )
