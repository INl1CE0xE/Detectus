import os
import tempfile
import uuid
import json
from datetime import datetime


from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles


from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException
from webdriver_manager.chrome import ChromeDriverManager

# ------- Константы (ЛУЧШЕ ВЗЯТЬ ИЗ ПЕРЕМЕННЫХ ОКРУЖЕНИЯ) -------

LOGIN_URL = "https://dashboard.sightengine.com/login"
AI_URL = "https://dashboard.sightengine.com/ai-image-detection"

EMAIL = os.getenv("SIGHTENGINE_EMAIL", "kuruevmaxamma@gmail.com")
PASSWORD = os.getenv("SIGHTENGINE_PASSWORD", "Dagi@123")  # <-- лучше вынести в env в реальном проекте


# ------- Логика ожидания результата -------

def wait_for_result_text(driver):
    """
    Функция для WebDriverWait: возвращает текст result-zone, когда он готов.
    Иначе — False, чтобы WebDriverWait продолжал ждать.
    """
    try:
        zone = driver.find_element(By.ID, "result-zone")
        txt = zone.text.strip()
        if not txt:
            return False
        if "Upload image to view results" in txt:
            return False
        return txt  # WebDriverWait вернёт это значение
    except Exception:
        return False


def run_sightengine_analysis(image_path: str) -> dict:
    """
    Запускает Chrome через Selenium, логинится, загружает картинку,
    ждёт результат и возвращает словарь с данными анализа.
    """
    options = webdriver.ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    # Для сервера можно использовать headless:
    # options.add_argument("--headless=new")

    driver = webdriver.Chrome(
        service=Service(ChromeDriverManager().install()),
        options=options
    )

    try:
        # -------- 1. Авторизация --------
        driver.get(LOGIN_URL)

        WebDriverWait(driver, 20).until(
            EC.presence_of_element_located((By.ID, "loginform"))
        )

        email_input = driver.find_element(By.ID, "firstfocus")
        email_input.clear()
        email_input.send_keys(EMAIL)

        password_input = driver.find_element(By.NAME, "password")
        password_input.clear()
        password_input.send_keys(PASSWORD)

        submit_btn = driver.find_element(
            By.CSS_SELECTOR,
            "#loginform input[type='submit']"
        )
        submit_btn.click()

        WebDriverWait(driver, 20).until(
            lambda d: "/login" not in d.current_url
        )

        # -------- 2. Переход на страницу AI image detection --------
        driver.get(AI_URL)

        WebDriverWait(driver, 20).until(
            EC.presence_of_element_located((By.ID, "left-pane"))
        )

        # -------- 3. Поиск input[type=file] и загрузка файла --------
        file_input = WebDriverWait(driver, 20).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, "input[type='file']"))
        )

        file_input.send_keys(image_path)

        # -------- 4. Ждём появления нормального текста в result-zone --------
        try:
            result_text = WebDriverWait(driver, 60).until(wait_for_result_text)
        except TimeoutException:
            # Попробуем вытащить хоть что-то для дебага
            try:
                zone = driver.find_element(By.ID, "result-zone")
                debug_text = zone.text
            except Exception:
                debug_text = ""
            raise RuntimeError(
                f"Не удалось дождаться результата анализа. Текущий result-zone: {debug_text}"
            )

        # -------- 5. Разбираем ключевые элементы --------
        result_zone = driver.find_element(By.ID, "result-zone")

        # видимый h3 (Likely AI-generated / Likely Deepfake / ...)
        summary_h3 = result_zone.find_element(
            By.CSS_SELECTOR,
            "#result-summary h3:not([style*='display:none'])"
        )
        summary_text = summary_h3.text.strip()

        score_div = result_zone.find_element(
            By.CSS_SELECTOR, "#result-summary .aiscore"
        )
        score_text = score_div.text.strip()

        genai_percent = result_zone.find_element(
            By.ID, "genai-percent"
        ).text.strip()
        deepfake_percent = result_zone.find_element(
            By.ID, "deepfake-percent"
        ).text.strip()

        # Собираем ответ
        return {
            "summary": summary_text,
            "score": score_text,
            "genai_percent": genai_percent,
            "deepfake_percent": deepfake_percent,
            "raw_text": result_text,
        }

    finally:
        # В веб-сервисе браузер закрываем обязательно
        driver.quit()


# ------- FastAPI-приложение -------

app = FastAPI(title="Sightengine Dashboard Wrapper")
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")

# Папка для загруженных картинок
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
HISTORY_FILE = os.path.join(BASE_DIR, "history.jsonl")


@app.get("/", response_class=HTMLResponse)
async def home():
    template_path = os.path.join(BASE_DIR, "templates", "index.html")
    with open(template_path, "r", encoding="utf-8") as f:
        html = f.read()
    return HTMLResponse(content=html)



@app.post("/analyze")
async def analyze_image(file: UploadFile = File(...)):
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Нужно загрузить файл изображения")

    # 1. Читаем загруженный файл
    try:
        content = await file.read()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Не удалось прочитать файл: {e}")

    # 2. Сохраняем в uploads с уникальным именем
    try:
        _, ext = os.path.splitext(file.filename or "")
        if not ext:
            ext = ".jpg"
        image_id = uuid.uuid4().hex
        unique_name = f"{image_id}{ext}"
        save_path = os.path.join(UPLOAD_DIR, unique_name)

        with open(save_path, "wb") as f:
            f.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Не удалось сохранить файл: {e}")

    # 3. Анализ через Selenium
    try:
        result = run_sightengine_analysis(save_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    image_url = f"/uploads/{unique_name}"

    # 4. Запись для истории (всё — строки/числа, без datetime-объектов)
    record = {
        "id": image_id,
        "image_url": image_url,
        "summary": result.get("summary"),
        "score": result.get("score"),
        "genai_percent": result.get("genai_percent"),
        "deepfake_percent": result.get("deepfake_percent"),
        "raw_text": result.get("raw_text"),
        "created_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    # 5. Пишем в history.jsonl (по строке JSON на запись)
    try:
        with open(HISTORY_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
        print("Записали в history.jsonl:", record["id"])
    except Exception as e:
        # важно: не молчим, а пишем в логи
        print("Ошибка записи истории:", e)

    # 6. Добавляем служебные поля в ответ клиенту
    result["image_url"] = image_url
    result["id"] = image_id

    return JSONResponse(content=result)


@app.get("/history")
def get_history(limit: int = 10):
    items = []
    if os.path.exists(HISTORY_FILE):
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    items.append(obj)
                except Exception as e:
                    print("Ошибка чтения строки history:", e)
                    continue

    # сортируем по времени (новые сверху)
    def sort_key(x):
        return x.get("created_at", "")

    items.sort(key=sort_key, reverse=True)
    return items[:limit]
