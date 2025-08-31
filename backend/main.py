import os
import uuid
import traceback
from typing import Dict

from dotenv import load_dotenv
from flask import Flask, request, jsonify, Response
from flask_cors import CORS

# ---- LangChain / OpenAI (current APIs) ----
from langchain_openai import ChatOpenAI, OpenAIEmbeddings

from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables.history import RunnableWithMessageHistory

from langchain.text_splitter import RecursiveCharacterTextSplitter

# Retrieval (new-style)
from langchain.chains.combine_documents import create_stuff_documents_chain
from langchain.chains import create_retrieval_chain

from langchain_chroma import Chroma

# Chat history (per-session, in-memory)
from langchain_community.chat_message_histories import ChatMessageHistory

from PyPDF2 import PdfReader

# ---- ElevenLabs (STT/TTS) ----
from elevenlabs.client import ElevenLabs
from elevenlabs import VoiceSettings

# ------------ Setup ------------
load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
ELEVEN_API_KEY = os.getenv("ELEVENLABS_API_KEY")
DEFAULT_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID")

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": ["http://localhost:3000", "http://localhost:5173"]}})

el = ElevenLabs(api_key=ELEVEN_API_KEY)

# ------------ LLMs / Embeddings ------------
ASK_ONCE_LLM = ChatOpenAI(model="gpt-4o-mini", temperature=0.5)
CHAT_LLM = ChatOpenAI(model="gpt-4o-mini", temperature=0.5)
embeddings = OpenAIEmbeddings(openai_api_key=OPENAI_API_KEY)

# ------------ Persistent Chroma ------------
# Use a folder on disk so vectors survive restarts and work across processes.
CHROMA_DIR = os.path.join(os.path.dirname(__file__), "chroma_data")

vector_store = Chroma(
    collection_name="pdf_collection",
    embedding_function=embeddings,
    persist_directory=CHROMA_DIR,  # persistence is automatic in langchain_chroma
)
retriever = vector_store.as_retriever(search_kwargs={"k": 3})

# ------------ System / Prompting ------------
TUTOR_SYSTEM_TEXT = (
    "Respond in a format understandable by the eleven_multilingual_v2 model."
    "You are a world-class tutor with PhD-level knowledge. "
    "Teach intuitively and clearly: start with a concise answer, then explain step-by-step "
    "in simple language. Use examples or analogies when helpful. Prefer bullets and short paragraphs."
)

# Ask Once (retrieval) prompt (ChatPromptTemplate)
QA_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", TUTOR_SYSTEM_TEXT + "\nUse the provided context to answer the question."),
        ("human",
         "Context:\n{context}\n\n"
         "Question: {input}\n\n"
         "Answer as a patient, intuitive tutor. Keep it clear and step-by-step, "
         "and include an example if useful.")
    ]
)

# Build the new-style retrieval chain for Ask Once
qa_doc_chain = create_stuff_documents_chain(ASK_ONCE_LLM, QA_PROMPT)
qa_chain = create_retrieval_chain(retriever, qa_doc_chain)
# qa_chain.invoke({"input": question}) -> {"answer": ..., "context": [...]}

# ------------ Chat (RunnableWithMessageHistory) ------------
# Per-session history store (in-memory)
SESSION_HISTORIES: Dict[str, ChatMessageHistory] = {}

def get_history(session_id: str) -> ChatMessageHistory:
    if session_id not in SESSION_HISTORIES:
        SESSION_HISTORIES[session_id] = ChatMessageHistory()
    return SESSION_HISTORIES[session_id]

def history_factory(config_or_session):
    """
    Supports both calling conventions used across LangChain versions:
    - history_factory(session_id: str)
    - history_factory(config: dict) where config.get('configurable', {}).get('session_id')
    """
    if isinstance(config_or_session, str):
        sid = config_or_session or "default"
        return get_history(sid)
    # assume dict-like
    cfg = config_or_session or {}
    sid = (cfg.get("configurable") or {}).get("session_id", "default")
    return get_history(sid)

# Chat prompt with memory placeholder + optional retrieval context
CHAT_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", TUTOR_SYSTEM_TEXT),
        MessagesPlaceholder(variable_name="chat_history"),
        ("human",
         "Use this (optional) context if helpful:\n{context}\n\n"
         "Now answer the user's message:\n{text}")
    ]
)

chat_core_chain = CHAT_PROMPT | CHAT_LLM | StrOutputParser()

chat_chain_with_history = RunnableWithMessageHistory(
    chat_core_chain,
    history_factory,  # <-- fixed here
    input_messages_key="text",
    history_messages_key="chat_history",
)

# ------------ Routes ------------
@app.get("/")
def health():
    return jsonify({"ok": True})

# /upload — Upload PDF and store in vector DB (persistent)
@app.post("/upload")
def upload_pdf():
    file = request.files.get("file")
    if not file or not file.filename.lower().endswith(".pdf"):
        return jsonify({"detail": "Only PDF allowed"}), 400

    reader = PdfReader(file)
    text = ""
    for page in reader.pages:
        try:
            t = page.extract_text() or ""
        except Exception:
            t = ""
        if t:
            text += t + "\n"

    splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    chunks = splitter.split_text(text)

    if not chunks:
        return jsonify({"detail": "No extractable text found in PDF"}), 400

    metadatas = [{"source": file.filename} for _ in chunks]
    vector_store.add_texts(chunks, metadatas=metadatas)

    # NOTE: No explicit persist() here — persistence is automatic with persist_directory
    return jsonify({"detail": f"Stored {len(chunks)} chunks in Chroma (persistent)"}), 200

# /query — Ask Once (stateless but uses vector DB for context)
@app.post("/query")
def query():
    payload = request.get_json(silent=True) or {}
    question = payload.get("question")

    # New retrieval chain API
    result = qa_chain.invoke({"input": question})

    # result has keys: "answer", "context"
    answer = result.get("answer", "")
    return jsonify({"answer": answer})

# /chat — Stateful conversation (session + memory + optional retrieval)
@app.post("/chat")
def chat():
    payload = request.get_json(silent=True) or {}
    message = payload.get("message")

    session_id = payload.get("session_id") or str(uuid.uuid4())

    # Use retriever.invoke (no deprecation)
    docs = retriever.invoke(message)  # returns List[Document]
    context = "\n\n".join(d.page_content for d in docs) if docs else ""

    # Invoke with message history via config
    answer = chat_chain_with_history.invoke(
        {"text": message, "context": context},
        config={"configurable": {"session_id": session_id}},
    )

    return jsonify({"answer": answer, "session_id": session_id})

# /stt — Speech → Text
@app.post("/stt")
def stt():
    f = request.files.get("file")

    audio_bytes = f.read()

    try:
        result = el.speech_to_text.convert(file=audio_bytes, model_id="scribe_v1")

        # SDK sometimes yields a single object, sometimes a generator of chunks
        if hasattr(result, "model_dump"):
            data = result.model_dump()
            text = data.get("text") or data.get("transcript") or ""
            return jsonify({"text": text, "details": data})

        collected, text_parts = [], []
        for chunk in result:
            d = chunk.model_dump() if hasattr(chunk, "model_dump") else {"repr": repr(chunk)}
            collected.append(d)
            t = d.get("text") or d.get("word") or d.get("transcription") or ""
            if t:
                text_parts.append(t)

        return jsonify({"text": " ".join(text_parts).strip(), "details": collected})

    except Exception as e:
        traceback.print_exc()
        return jsonify({"detail": str(e)}), 502

# /tts — Text → Speech
@app.post("/tts")
def tts():
    payload = request.get_json(silent=True) or {}
    text = payload.get("text")

    voice_id = DEFAULT_VOICE_ID
    model_id = "eleven_multilingual_v2"
    output_format = "mp3_44100_128"

    try:
        audio_iter = el.text_to_speech.convert(
            text=text,
            voice_id=voice_id,
            model_id=model_id,
            output_format=output_format,
            voice_settings=VoiceSettings(
                stability=float(payload.get("stability", 0.5)),
                similarity_boost=0.85,
                style=0.25,
                use_speaker_boost=True,
                speed=1.0,
            ),
        )
        audio_bytes = b"".join(chunk for chunk in audio_iter if chunk)
        return Response(audio_bytes, mimetype="audio/mpeg")

    except Exception as e:
        traceback.print_exc()
        return jsonify({
            "detail": str(e),
            "hint": {
                "voice_id": voice_id,
                "model_id": model_id,
                "output_format": output_format
            }
        }), 502

# ------------ Run ------------
if __name__ == "__main__":
    # debug=True is fine for local dev; set to False in prod
    # (If you see dev reloader causing double-process issues, add use_reloader=False)
    app.run(host="0.0.0.0", port=8000, debug=True)
