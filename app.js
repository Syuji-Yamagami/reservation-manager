
"use strict";

/* =====================================
   予約管理アプリ
   保存先：IndexedDB
===================================== */

const DB_NAME = "ReservationManagerDB";
const DB_VERSION = 1;
const STORE_NAME = "reservations";

let db = null;
let reservations = [];
let currentFilter = "all";
let selectedKana = "";
let toastTimer = null;

const KANA_GROUPS = [
    { label: "あ", chars: "あいうえお" },
    { label: "か", chars: "かきくけこがぎぐげご" },
    { label: "さ", chars: "さしすせそざじずぜぞ" },
    { label: "た", chars: "たちつてとだぢづでど" },
    { label: "な", chars: "なにぬねの" },
    { label: "は", chars: "はひふへほばびぶべぼぱぴぷぺぽ" },
    { label: "ま", chars: "まみむめも" },
    { label: "や", chars: "やゆよ" },
    { label: "ら", chars: "らりるれろ" },
    { label: "わ", chars: "わをん" }
];

const REQUIRED_HEADERS = [
    ["氏名"],
    ["フリガナ"],
    ["予約番号"],
    ["商品番号"],
    ["予約時間"],
    ["お渡し状況"],
    ["お渡し完了時刻"]
];

/* =====================================
   初期化
===================================== */

document.addEventListener("DOMContentLoaded", async () => {
    try {
        db = await openDatabase();

        await loadReservations();

        setupEvents();
        renderKanaButtons();
        renderReservations();
        updateStatistics();
        updateStorageInfo();

        registerServiceWorker();

    } catch (error) {
        console.error(error);
        alert("アプリの初期化に失敗した。\n" + error.message);
    }
});

/* =====================================
   IndexedDB
===================================== */

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const database = request.result;

            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, {
                    keyPath: "id"
                });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function getStore(mode = "readonly") {
    return db.transaction(STORE_NAME, mode)
        .objectStore(STORE_NAME);
}

function loadReservations() {
    return new Promise((resolve, reject) => {
        const request = getStore().getAll();

        request.onsuccess = () => {
            reservations = request.result || [];
            resolve();
        };

        request.onerror = () => reject(request.error);
    });
}

function saveReservation(item) {
    return new Promise((resolve, reject) => {
        const request = getStore("readwrite").put(item);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

function saveAllReservations(items) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(
            STORE_NAME,
            "readwrite"
        );

        const store = transaction.objectStore(STORE_NAME);

        store.clear();

        for (const item of items) {
            store.put(item);
        }

        transaction.oncomplete = () => resolve();

        transaction.onerror = () => {
            reject(transaction.error);
        };

        transaction.onabort = () => {
            reject(transaction.error);
        };
    });
}

/* =====================================
   画面イベント
===================================== */

function setupEvents() {
    document.getElementById("searchInput")
        .addEventListener("input", renderReservations);

    document.querySelectorAll(".filter-button")
        .forEach(button => {
            button.addEventListener("click", () => {
                currentFilter = button.dataset.filter;

                document.querySelectorAll(".filter-button")
                    .forEach(item => {
                        item.classList.remove("selected");
                    });

                button.classList.add("selected");

                renderReservations();
            });
        });

    document.querySelectorAll(".nav-button")
        .forEach(button => {
            button.addEventListener("click", () => {
                changePage(button.dataset.page);
            });
        });

    document.getElementById("reservationList")
        .addEventListener("click", async event => {
            const button = event.target.closest("[data-action]");

            if (!button) return;

            if (button.dataset.action === "toggle") {
                await toggleReservation(button.dataset.id);
            }
        });

    document.getElementById("excelFile")
        .addEventListener("change", importExcel);

    document.getElementById("exportBackup")
        .addEventListener("click", exportBackup);

    document.getElementById("backupFile")
        .addEventListener("change", importBackup);
}

function changePage(pageName) {
    document.querySelectorAll(".page")
        .forEach(page => page.classList.remove("active"));

    document.querySelectorAll(".nav-button")
        .forEach(button => button.classList.remove("active"));

    const page = document.getElementById(`page-${pageName}`);

    const navButton = document.querySelector(
        `.nav-button[data-page="${pageName}"]`
    );

    if (!page || !navButton) return;

    page.classList.add("active");
    navButton.classList.add("active");
}

/* =====================================
   五十音検索
===================================== */

function renderKanaButtons() {
    const container = document.getElementById("kanaGrid");

    container.innerHTML = "";

    const allButton = document.createElement("button");

    allButton.className = "kana-button selected";
    allButton.textContent = "全";
    allButton.dataset.kana = "";

    container.appendChild(allButton);

    KANA_GROUPS.forEach(group => {
        const button = document.createElement("button");

        button.className = "kana-button";
        button.textContent = group.label;
        button.dataset.kana = group.label;

        container.appendChild(button);
    });

    container.addEventListener("click", event => {
        const button = event.target.closest(".kana-button");

        if (!button) return;

        selectedKana = button.dataset.kana;

        container.querySelectorAll(".kana-button")
            .forEach(item => item.classList.remove("selected"));

        button.classList.add("selected");

        renderReservations();
    });
}

function normalizeKana(value) {
    return String(value || "")
        .trim()
        .replace(/[ァ-ヶ]/g, char =>
            String.fromCharCode(char.charCodeAt(0) - 0x60)
        );
}

function getKanaGroup(value) {
    const text = normalizeKana(value);

    if (!text) return "";

    const first = text.charAt(0);

    for (const group of KANA_GROUPS) {
        if (group.chars.includes(first)) {
            return group.label;
        }
    }

    return "";
}

/* =====================================
   予約一覧表示
===================================== */

function renderReservations() {
    const container = document.getElementById("reservationList");

    const search = document.getElementById("searchInput")
        .value.trim().toLowerCase();

    const filtered = reservations.filter(item => {
        const searchTarget = [
            item.name,
            item.kana,
            item.reservationNumber,
            item.productNumber
        ].join(" ").toLowerCase();

        const matchesSearch =
            !search || searchTarget.includes(search);

        const matchesFilter =
            currentFilter === "all" ||
            (currentFilter === "pending" && !item.completed) ||
            (currentFilter === "completed" && item.completed);

        const matchesKana =
            !selectedKana ||
            getKanaGroup(item.kana || item.name) === selectedKana;

        return matchesSearch && matchesFilter && matchesKana;
    });

    filtered.sort((a, b) => {
        return String(a.kana || a.name)
            .localeCompare(String(b.kana || b.name), "ja");
    });

    container.innerHTML = "";

    document.getElementById("resultCount").textContent =
        `${filtered.length}件`;

    if (filtered.length === 0) {
        container.innerHTML =
            '<div class="empty-state">該当する予約者はいない。</div>';
        return;
    }

    filtered.forEach(item => {
        const card = document.createElement("article");

        card.className = "reservation-card";

        const badgeClass = item.completed
            ? "completed"
            : "pending";

        const badgeText = item.completed
            ? "お渡し済み"
            : "未お渡し";

        const buttonText = item.completed
            ? "お渡しを取り消す"
            : "お渡し完了";

        const buttonClass = item.completed
            ? "card-button undo"
            : "card-button";

        card.innerHTML = `
            <div class="card-top">
                <div class="person-name">
                    ${escapeHTML(item.name)}
                </div>

                <span class="status-badge ${badgeClass}">
                    ${badgeText}
                </span>
            </div>

            <div class="card-meta">
                <div class="meta-item">
                    <small>フリガナ</small>
                    <strong>${escapeHTML(item.kana)}</strong>
                </div>

                <div class="meta-item">
                    <small>予約番号</small>
                    <strong>${escapeHTML(item.reservationNumber)}</strong>
                </div>

                <div class="meta-item">
                    <small>商品番号</small>
                    <strong>${escapeHTML(item.productNumber)}</strong>
                </div>

                <div class="meta-item">
                    <small>予約時間</small>
                    <strong>${escapeHTML(item.reservationTime)}</strong>
                </div>

                <div class="meta-item">
                    <small>完了日時</small>
                    <strong>${escapeHTML(item.completedAt || "-")}</strong>
                </div>
            </div>

            <button
                class="${buttonClass}"
                data-action="toggle"
                data-id="${escapeHTML(item.id)}"
            >
                ${buttonText}
            </button>
        `;

        container.appendChild(card);
    });
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

/* =====================================
   受け渡し状況変更
===================================== */

async function toggleReservation(id) {
    const item = reservations.find(row => row.id === id);

    if (!item) return;

    const oldCompleted = item.completed;
    const oldCompletedAt = item.completedAt;

    item.completed = !oldCompleted;

    item.completedAt = item.completed
        ? formatDateTime(new Date())
        : "";

    try {
        await saveReservation(item);

        renderReservations();
        updateStatistics();
        updateStorageInfo();

        showToast(
            item.completed
                ? "お渡し完了に変更した。"
                : "未お渡しに戻した。"
        );

    } catch (error) {
        console.error(error);

        item.completed = oldCompleted;
        item.completedAt = oldCompletedAt;

        renderReservations();
        updateStatistics();

        showToast("保存に失敗した。");
    }
}

function formatDateTime(date) {
    const pad = value => String(value).padStart(2, "0");

    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join("/") + " " + [
        pad(date.getHours()),
        pad(date.getMinutes())
    ].join(":");
}

/* =====================================
   統計情報
===================================== */

function updateStatistics() {
    const total = reservations.length;

    const completed = reservations.filter(
        item => item.completed
    ).length;

    const pending = total - completed;

    document.getElementById("totalCount").textContent = total;
    document.getElementById("pendingCount").textContent = pending;
    document.getElementById("completedCount").textContent = completed;
}

function updateStorageInfo() {
    document.getElementById("storageInfo").textContent =
        `登録件数：${reservations.length}件`;
}

/* =====================================
   Excel読み込み
===================================== */

async function importExcel(event) {
    const file = event.target.files[0];

    if (!file) return;

    try {
        if (typeof XLSX === "undefined") {
            throw new Error(
                "Excel読み込みライブラリが見つからない。"
            );
        }

        const buffer = await file.arrayBuffer();

        const workbook = XLSX.read(buffer, {
            type: "array",
            cellDates: true
        });

        const sheetName = workbook.SheetNames[0];

        if (!sheetName) {
            throw new Error("Excelにシートがない。");
        }

        const sheet = workbook.Sheets[sheetName];

        const rows = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            defval: "",
            raw: false
        });

        if (rows.length < 2) {
            throw new Error("予約データが見つからない。");
        }

        const header = rows[0].map(value =>
            String(value).trim().replace(/\s/g, "")
        );

        const indexes = REQUIRED_HEADERS.map(candidates => {
            return header.findIndex(value =>
                candidates.some(candidate =>
                    value === candidate.replace(/\s/g, "")
                )
            );
        });

        const missing = [];

        REQUIRED_HEADERS.forEach((candidates, index) => {
            if (indexes[index] === -1) {
                missing.push(candidates[0]);
            }
        });

        if (missing.length > 0) {
            throw new Error(
                "Excelの見出しが不足している。\n" +
                "不足項目：" + missing.join("、")
            );
        }

        const newItems = [];

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];

            const getValue = index =>
                String(row[index] ?? "").trim();

            const name = getValue(indexes[0]);

            if (!name) continue;

            const completedText = getValue(indexes[5]);
            const completedAt = getValue(indexes[6]);

            newItems.push({
                id: createId(),
                name,
                kana: getValue(indexes[1]),
                reservationNumber: getValue(indexes[2]),
                productNumber: getValue(indexes[3]),
                reservationTime: getValue(indexes[4]),
                completed: isCompletedValue(completedText),
                completedAt,
                importedAt: new Date().toISOString()
            });
        }

        if (newItems.length === 0) {
            throw new Error("登録できる予約データがない。");
        }

        const mode = document.querySelector(
            'input[name="importMode"]:checked'
        ).value;

        if (mode === "replace") {
            const confirmed = confirm(
                `現在の予約データ${reservations.length}件を` +
                `削除して、${newItems.length}件に置き換える。\n\n` +
                "置き換え前に現在のデータをバックアップする。\n" +
                "続行するか？"
            );

            if (!confirmed) return;

            if (reservations.length > 0) {
                downloadBackupFile(
                    reservations,
                    "予約管理_置換前バックアップ"
                );
            }

            await saveAllReservations(newItems);
            reservations = newItems;

            showToast(`${newItems.length}件を置き換えた。`);

        } else {
            const existingKeys = new Set(
                reservations
                    .map(makeDuplicateKey)
                    .filter(Boolean)
            );

            const merged = [...reservations];

            let added = 0;
            let skipped = 0;

            for (const item of newItems) {
                const key = makeDuplicateKey(item);

                if (key && existingKeys.has(key)) {
                    skipped++;
                    continue;
                }

                if (key) {
                    existingKeys.add(key);
                }

                merged.push(item);
                added++;
            }

            await saveAllReservations(merged);
            reservations = merged;

            showToast(
                `${added}件追加、${skipped}件重複スキップ。`
            );
        }

        renderReservations();
        updateStatistics();
        updateStorageInfo();

    } catch (error) {
        console.error(error);

        alert(
            "Excel読み込みに失敗した。\n\n" +
            error.message
        );

    } finally {
        event.target.value = "";
    }
}

function isCompletedValue(value) {
    const normalized = String(value || "")
        .trim()
        .toLowerCase();

    return [
        "済",
        "完了",
        "お渡し済み",
        "true",
        "1"
    ].includes(normalized);
}

function makeDuplicateKey(item) {
    const reservationNumber =
        String(item.reservationNumber || "").trim();

    const productNumber =
        String(item.productNumber || "").trim();

    if (!reservationNumber || !productNumber) {
        return "";
    }

    return `${reservationNumber}|${productNumber}`;
}

function createId() {
    if (crypto.randomUUID) {
        return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/* =====================================
   JSONバックアップ
===================================== */

function createBackupData(items) {
    return {
        version: 1,
        exportedAt: new Date().toISOString(),
        reservations: items
    };
}

function downloadBackupFile(items, prefix) {
    const data = createBackupData(items);

    const blob = new Blob(
        [JSON.stringify(data, null, 2)],
        { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;

    link.download =
        `${prefix}_${new Date().toISOString().slice(0, 10)}.json`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportBackup() {
    downloadBackupFile(
        reservations,
        "予約管理バックアップ"
    );

    showToast("バックアップを書き出した。");
}

/* =====================================
   JSON復元
===================================== */

async function importBackup(event) {
    const file = event.target.files[0];

    if (!file) return;

    try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (
            !data ||
            data.version !== 1 ||
            !Array.isArray(data.reservations)
        ) {
            throw new Error("バックアップ形式が正しくない。");
        }

        const restored = data.reservations.map(item => {
            if (
                !item ||
                typeof item.id !== "string" ||
                !item.id ||
                typeof item.name !== "string" ||
                !item.name.trim()
            ) {
                throw new Error(
                    "予約データに不正な項目がある。"
                );
            }

            return {
                id: item.id,
                name: item.name,
                kana: String(item.kana || ""),
                reservationNumber:
                    String(item.reservationNumber || ""),
                productNumber:
                    String(item.productNumber || ""),
                reservationTime:
                    String(item.reservationTime || ""),
                completed: item.completed === true,
                completedAt: String(item.completedAt || ""),
                importedAt: String(item.importedAt || "")
            };
        });

        const ids = new Set();

        for (const item of restored) {
            if (ids.has(item.id)) {
                throw new Error(
                    "バックアップ内に重複したデータIDがある。"
                );
            }

            ids.add(item.id);
        }

        const confirmed = confirm(
            `現在の${reservations.length}件を削除し、` +
            `${restored.length}件を復元する。\n\n` +
            "現在のデータは復元前にバックアップする。\n" +
            "続行するか？"
        );

        if (!confirmed) return;

        if (reservations.length > 0) {
            downloadBackupFile(
                reservations,
                "予約管理_復元前バックアップ"
            );
        }

        await saveAllReservations(restored);

        reservations = restored;

        renderReservations();
        updateStatistics();
        updateStorageInfo();

        showToast("バックアップを復元した。");

    } catch (error) {
        console.error(error);

        alert(
            "バックアップ復元に失敗した。\n\n" +
            error.message
        );

    } finally {
        event.target.value = "";
    }
}

/* =====================================
   PWA
===================================== */

async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    try {
        await navigator.serviceWorker.register("./sw.js");

    } catch (error) {
        console.error(
            "Service Worker登録失敗:",
            error
        );
    }
}

/* =====================================
   通知
===================================== */

function showToast(message) {
    const toast = document.getElementById("toast");

    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 2500);
}
