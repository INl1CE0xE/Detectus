// ---------- Ссылки на элементы интерфейса ----------

// Левая часть: загрузка
const uploadArea = document.getElementById("upload-area");
const fileInput = document.getElementById("file-input");
const chooseBtn = document.getElementById("choose-btn");
const previewBlock = document.getElementById("preview-block");
const previewThumb = document.getElementById("preview-thumb");
const previewName = document.getElementById("preview-name");
const previewSize = document.getElementById("preview-size");

// Кнопка анализа и статусы
const analyzeBtn = document.getElementById("analyze-btn");
const analyzeSpinner = document.getElementById("analyze-spinner");
const analyzeText = document.getElementById("analyze-text");
const statusText = document.getElementById("status-text");
const errorText = document.getElementById("error-text");

// Правая часть: результат
const resultImage = document.getElementById("result-image");
const resultImageImg = document.getElementById("result-image-img");

const summaryChip = document.getElementById("summary-chip");
const summaryDot = document.getElementById("summary-dot");
const summaryText = document.getElementById("summary-text");
const placeholderText = document.getElementById("placeholder-text");

// Основные цифры
const scoreTotal = document.getElementById("score-total");
const scoreGenai = document.getElementById("score-genai");
const scoreDeepfake = document.getElementById("score-deepfake");
const scoreTotalBar = document.getElementById("score-total-bar");
const scoreGenaiBar = document.getElementById("score-genai-bar");
const scoreDeepfakeBar = document.getElementById("score-deepfake-bar");

// Модели Diffusion / GAN
const diffusionBlock = document.getElementById("diffusion-block");
const diffusionTags = document.getElementById("diffusion-tags");
const ganBlock = document.getElementById("gan-block");
const ganTags = document.getElementById("gan-tags");

// История
const historyStrip = document.getElementById("history-strip");
const historyNote = document.getElementById("history-note");
let historyItems = [];


// ---------- Вспомогательные функции ----------

function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let val = bytes;
    while (val >= 1024 && i < units.length - 1) {
        val /= 1024;
        i++;
    }
    return val.toFixed(1) + " " + units[i];
}

function parsePercent(str) {
    if (!str) return 0;
    const num = parseFloat(String(str).replace("%", "").trim());
    return isNaN(num) ? 0 : num;
}

// Разбор текстового блока на Diffusion / GAN модели
function parseModelBreakdown(raw) {
    if (!raw) return { diffusion: [], gan: [] };

    const lines = raw
        .split(/[\r\n]+/)
        .map(l => l.trim())
        .filter(Boolean);

    let mode = null; // null | "diffusion" | "gan"
    const diffusion = [];
    const gan = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line === "Diffusion") {
            mode = "diffusion";
            continue;
        }
        if (line === "GAN") {
            mode = "gan";
            continue;
        }

        if (!mode) continue;

        const next = lines[i + 1];
        // ожидаем строку вида "62%"
        if (next && /^\d+%$/.test(next)) {
            const value = parsePercent(next);
            const item = { name: line, value };

            if (mode === "diffusion") diffusion.push(item);
            else if (mode === "gan") gan.push(item);

            i++; // пропускаем строку с процентом
        }
    }

    diffusion.sort((a, b) => b.value - a.value);
    gan.sort((a, b) => b.value - a.value);

    return { diffusion, gan };
}

function renderModelTags(container, items) {
    container.innerHTML = "";
    items.forEach(item => {
        const pill = document.createElement("div");
        pill.className = "tag-pill";
        pill.innerHTML = `
            <span class="tag-label">${item.name}</span>
            <span class="tag-value">${item.value}%</span>
        `;
        container.appendChild(pill);
    });
}

// Настройка чипа summary (Likely AI-generated / Deepfake / Not AI)
function applySummary(summary) {
    if (!summary) {
        summaryChip.style.display = "none";
        return;
    }

    let mode = "notai";
    const s = summary.toLowerCase();

    if (s.includes("deepfake")) {
        mode = "deepfake";
    } else if (s.includes("ai-generated") || s.includes("ai generated") || s.includes("ai-")) {
        mode = "ai";
    } else {
        mode = "notai";
    }

    summaryChip.classList.remove("ai", "deepfake", "notai");
    summaryDot.classList.remove("ai", "deepfake");

    if (mode === "ai") {
        summaryChip.classList.add("ai");
        summaryDot.classList.add("ai");
    } else if (mode === "deepfake") {
        summaryChip.classList.add("deepfake");
        summaryDot.classList.add("deepfake");
    } else {
        summaryChip.classList.add("notai");
    }

    summaryText.textContent = summary;
    summaryChip.style.display = "inline-flex";
}


// ---------- Логика загрузки файла (левая часть) ----------

function setFile(file) {
    if (!file) return;
    errorText.textContent = "";
    previewBlock.style.display = "flex";
    previewName.textContent = file.name;
    previewSize.textContent = formatBytes(file.size);

    if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = e => {
            const img = document.createElement("img");
            img.src = e.target.result;
            previewThumb.innerHTML = "";
            previewThumb.appendChild(img);
        };
        reader.readAsDataURL(file);
    } else {
        previewThumb.textContent = "🖼️";
    }

    analyzeBtn.disabled = false;
    statusText.innerHTML = "<strong>Шаг 2.</strong> Нажмите «Отправить на анализ»";
}

function setLoading(isLoading) {
    if (isLoading) {
        analyzeBtn.disabled = true;
        analyzeSpinner.style.display = "block";
        analyzeText.textContent = "Анализируем...";
        statusText.innerHTML = "<strong>Шаг 3.</strong> Идёт запрос к Sightengine, подождите…";
    } else {
        analyzeSpinner.style.display = "none";
        analyzeText.textContent = "Отправить на анализ";
    }
}


// ---------- Отрисовка результата анализа (общая для /analyze и истории) ----------

function renderAnalysisResult(data, fromHistory = false) {
    placeholderText.style.display = "none";
    errorText.textContent = "";

    // summary
    applySummary(data.summary);

    // картинка с сервера
    if (data.image_url) {
        resultImageImg.src = data.image_url;
        resultImage.style.display = "flex";
    } else {
        resultImage.style.display = "none";
    }

    // основные проценты
    scoreTotal.textContent = data.score || "–";
    scoreGenai.textContent = data.genai_percent || "–";
    scoreDeepfake.textContent = data.deepfake_percent || "–";

    const totalVal = parsePercent(data.score);
    const genaiVal = parsePercent(data.genai_percent);
    const deepfakeVal = parsePercent(data.deepfake_percent);

    scoreTotalBar.style.width = totalVal + "%";
    scoreGenaiBar.style.width = genaiVal + "%";
    scoreDeepfakeBar.style.width = deepfakeVal + "%";

    // модели Diffusion / GAN
    const breakdown = parseModelBreakdown(data.raw_text || "");
    if (breakdown.diffusion.length > 0) {
        diffusionBlock.style.display = "block";
        renderModelTags(diffusionTags, breakdown.diffusion);
    } else {
        diffusionBlock.style.display = "none";
    }

    if (breakdown.gan.length > 0) {
        ganBlock.style.display = "block";
        renderModelTags(ganTags, breakdown.gan);
    } else {
        ganBlock.style.display = "none";
    }

    if (fromHistory) {
        statusText.innerHTML = "<strong>Показан сохранённый результат.</strong> Можно загрузить новое изображение.";
    } else {
        statusText.innerHTML = "<strong>Готово!</strong> Результат ниже, можно пробовать другое изображение.";
    }
}


// ---------- История последних анализов ----------

function renderHistory(items) {
    historyStrip.innerHTML = "";
    if (!items || items.length === 0) {
        historyNote.textContent = "Нет записей";
        return;
    }

    historyNote.textContent = `Записей: ${items.length}`;

    items.forEach(item => {
        const card = document.createElement("div");
        card.className = "history-card";

        card.addEventListener("click", () => {
            renderAnalysisResult(item, true);
        });

        const thumb = document.createElement("div");
        thumb.className = "history-thumb";
        const img = document.createElement("img");
        img.src = item.image_url;
        thumb.appendChild(img);

        const infoWrap = document.createElement("div");
        const main = document.createElement("div");
        main.className = "history-info-main";
        main.textContent = item.summary || "Без сводки";

        const sub = document.createElement("div");
        sub.className = "history-info-sub";
        const score = item.score || "–";
        const genai = item.genai_percent || "–";
        const deepfake = item.deepfake_percent || "–";
        sub.textContent = `AI: ${score} · GenAI: ${genai} · Face: ${deepfake}`;

        infoWrap.appendChild(main);
        infoWrap.appendChild(sub);

        card.appendChild(thumb);
        card.appendChild(infoWrap);

        historyStrip.appendChild(card);
    });
}

async function loadHistory() {
    try {
        const res = await fetch("/history?limit=8");
        if (!res.ok) {
            throw new Error("HTTP " + res.status);
        }
        const data = await res.json();
        historyItems = data || [];
        renderHistory(historyItems);
    } catch (err) {
        console.error("Ошибка загрузки истории:", err);
        historyNote.textContent = "Не удалось загрузить историю";
    }
}


// ---------- Обработчики событий ----------

// Выбор файла через кнопку
chooseBtn.addEventListener("click", () => fileInput.click());

// Выбор файла через диалог
fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) setFile(file);
});

// Drag & Drop
["dragenter", "dragover"].forEach(eventName => {
    uploadArea.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadArea.classList.add("dragover");
    });
});

["dragleave", "drop"].forEach(eventName => {
    uploadArea.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadArea.classList.remove("dragover");
    });
});

uploadArea.addEventListener("drop", (e) => {
    const dt = e.dataTransfer;
    const file = dt.files[0];
    if (file) {
        fileInput.files = dt.files;
        setFile(file);
    }
});

// Кнопка "Отправить на анализ"
analyzeBtn.addEventListener("click", async () => {
    const file = fileInput.files[0];
    if (!file) {
        errorText.textContent = "Сначала выберите файл изображения.";
        return;
    }

    errorText.textContent = "";
    setLoading(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
        const response = await fetch("/analyze", {
            method: "POST",
            body: formData
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(text || ("HTTP " + response.status));
        }

        const data = await response.json();

        // Отрисовываем результат и обновляем историю
        renderAnalysisResult(data, false);

        historyItems.unshift(data);
        historyItems = historyItems.slice(0, 8);
        renderHistory(historyItems);
    } catch (err) {
        console.error(err);
        errorText.textContent = "Ошибка при запросе /analyze: " + err.message;
        statusText.innerHTML = "<strong>Ошибка.</strong> Попробуйте ещё раз или проверьте логи сервера.";
    } finally {
        setLoading(false);
        analyzeBtn.disabled = false;
    }
});

// При загрузке страницы подгружаем историю
window.addEventListener("load", () => {
    loadHistory();
});
