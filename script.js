import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, addDoc, onSnapshot, collection, query, serverTimestamp, deleteDoc, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const container = document.querySelector(".container");
const chatsContainer = document.querySelector(".chats-container");
const promptForm = document.querySelector(".prompt-form");
const promptInput = promptForm.querySelector(".prompt-input");
const fileInput = promptForm.querySelector("#file-input");
const fileUploadWrapper = promptForm.querySelector(".file-upload-wrapper");
const themeToggleBtn = document.querySelector("#theme-toggle-btn");
const deleteAllChatsBtn = document.querySelector("#delete-all-chats-btn");
const sidebar = document.querySelector('.sidebar');
const openSidebarBtn = document.querySelector('#open-sidebar-btn');
const closeSidebarBtn = document.querySelector('#close-sidebar-btn');
const newChatBtn = document.querySelector('#new-chat-btn');
const chatHistoryList = document.querySelector('#chat-history-list');
const userIdDisplay = document.querySelector('#user-id-display');
const welcomeHeader = document.querySelector('.app-header');
const welcomeSuggestions = document.querySelector('.suggestions');
const mobileChatTitle = document.querySelector('.mobile-chat-title');

let controller;
let typingInterval;
let userData = { message: "", file: {} };

let db, auth;
let userId;
let activeChatId = null;
let unsubscribeChatHistory = null;

const firebaseConfig = {
  apiKey: "AIzaSyBKXGnD5es5lQq6Jz4JcXaliAp6cahSIKg",
  authDomain: "alexr-ai.firebaseapp.com",
  projectId: "alexr-ai",
  storageBucket: "alexr-ai.firebasestorage.app",
  messagingSenderId: "1027395139056",
  appId: "1:1027395139056:web:211f297774a1a38c2d1935"
};
const app = initializeApp(firebaseConfig);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-alexr-ai-app';

async function main() {
    db = getFirestore(app);
    auth = getAuth(app);
    setupEventListeners();
    initializeTheme();
    await setupAuthentication();
}

function setupEventListeners() {
    promptForm.addEventListener("submit", handleFormSubmit);
    themeToggleBtn.addEventListener("click", toggleTheme);
    deleteAllChatsBtn.addEventListener("click", handleDeleteAllChats);
    newChatBtn.addEventListener("click", startNewChat);
    openSidebarBtn.addEventListener("click", () => sidebar.classList.add('open'));
    closeSidebarBtn.addEventListener("click", () => sidebar.classList.remove('open'));
    promptForm.querySelector("#add-file-btn").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", handleFileSelection);
    document.querySelector("#cancel-file-btn").addEventListener("click", clearFileAttachment);
    document.querySelector("#stop-response-btn").addEventListener("click", stopResponseGeneration);
    document.querySelectorAll(".suggestions-item").forEach(suggestion => {
        suggestion.addEventListener("click", () => {
            promptInput.value = suggestion.querySelector(".text").textContent;
            promptForm.dispatchEvent(new Event("submit"));
        });
    });
}

async function setupAuthentication() {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            userId = user.uid;
            userIdDisplay.textContent = userId.substring(0, 8) + '...';
            listenForChatHistory();
        } else {
             try {
                if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                    await signInWithCustomToken(auth, __initial_auth_token);
                } else {
                    await signInAnonymously(auth);
                }
            } catch (error) {
                alert("Could not connect to the chat service. Please refresh the page.");
            }
        }
    });
}

async function handleFormSubmit(e) {
    e.preventDefault();
    const userMessage = promptInput.value.trim();
    if (!userMessage || document.body.classList.contains("bot-responding")) return;
    userData.message = userMessage;
    promptInput.value = "";
    clearFileAttachment();
    const userMsgHTML = createUserMessageHTML(userData.message, userData.file);
    appendMessage('user-message', userMsgHTML);
    document.body.classList.add("chats-active", "bot-responding");
    const botMsgDiv = appendMessage('bot-message', `<img class="avatar" src="assets/gemini.png" /> <p class="message-text">...</p>`, 'loading');
    await saveAndProcessMessage(botMsgDiv);
}

async function saveAndProcessMessage(botMsgDiv) {
    try {
        let chatRef;
        let currentMessages = [];
        if (activeChatId) {
            chatRef = doc(db, "artifacts", appId, "users", userId, "chats", activeChatId);
            const chatSnap = await getDoc(chatRef);
            if (chatSnap.exists()) {
                currentMessages = chatSnap.data().messages || [];
            }
        } else {
            chatRef = doc(collection(db, "artifacts", appId, "users", userId, "chats"));
            activeChatId = chatRef.id;
        }
        const userMessageData = { role: "user", content: userData.message };
        const newMessages = [...currentMessages, userMessageData];
        const chatPayload = {
            messages: newMessages,
            updatedAt: serverTimestamp(),
            ...(currentMessages.length === 0 && { title: userData.message.substring(0, 40) + (userData.message.length > 40 ? '...' : '') })
        };
        await setDoc(chatRef, chatPayload, { merge: true });
        await generateResponse(botMsgDiv, newMessages, chatRef);
    } catch (error) {
        botMsgDiv.querySelector('.message-text').textContent = "Error: Could not save message.";
    } finally {
        document.body.classList.remove("bot-responding");
        userData = { message: "", file: {} };
    }
}

const generateResponse = async (botMsgDiv, messages, chatRef) => {
    const textElement = botMsgDiv.querySelector(".message-text");
    controller = new AbortController();
    try {
        botMsgDiv.classList.add("loading");
        const response = await fetch('https://alexr-ai.onrender.com/generate-response', {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: userData.message }),
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const responseData = await response.json();
        const responseText = responseData?.response || "Sorry, I couldn't get a response.";
        typingEffect(responseText, textElement, botMsgDiv);
        const botMessageData = { role: "assistant", content: responseText };
        await setDoc(chatRef, { messages: [...messages, botMessageData], updatedAt: serverTimestamp() }, { merge: true });
    } catch (error) {
        textElement.textContent = error.name === "AbortError" ? "Response stopped." : "An error occurred. Please try again.";
        textElement.style.color = "#d62939";
    } finally {
        botMsgDiv.classList.remove("loading");
        document.body.classList.remove("bot-responding");
        scrollToBottom();
    }
};

function startNewChat() {
    activeChatId = null;
    chatsContainer.innerHTML = "";
    document.body.classList.remove("chats-active");
    promptInput.focus();
    updateActiveChatInSidebar();
    if (window.innerWidth < 768) {
        sidebar.classList.remove('open');
    }
}

async function loadChat(chatId) {
    if (!userId || activeChatId === chatId) return;
    activeChatId = chatId;
    try {
        const chatRef = doc(db, "artifacts", appId, "users", userId, "chats", chatId);
        const chatSnap = await getDoc(chatRef);
        if (chatSnap.exists()) {
            const chatData = chatSnap.data();
            chatsContainer.innerHTML = '';
            chatData.messages.forEach(msg => {
                const messageHTML = (msg.role === 'user') ? createUserMessageHTML(msg.content) : createBotMessageHTML(msg.content);
                const messageClass = (msg.role === 'user') ? 'user-message' : 'bot-message';
                appendMessage(messageClass, messageHTML);
            });
            document.body.classList.add("chats-active");
            updateActiveChatInSidebar();
            mobileChatTitle.textContent = chatData.title || 'Chat';
             if (window.innerWidth < 768) {
                sidebar.classList.remove('open');
            }
        } else {
            startNewChat();
        }
    } catch (error) {}
}

async function handleDeleteAllChats() {
    if (!userId || !confirm("Are you sure you want to delete all your chats? This action cannot be undone.")) return;
    try {
        const chatsRef = collection(db, "artifacts", appId, "users", userId, "chats");
        const querySnapshot = await getDocs(chatsRef);
        const deletePromises = [];
        querySnapshot.forEach((doc) => {
            deletePromises.push(deleteDoc(doc.ref));
        });
        await Promise.all(deletePromises);
        startNewChat();
    } catch (error) {
        alert("Could not delete chats. Please try again.");
    }
}

function listenForChatHistory() {
    if (unsubscribeChatHistory) unsubscribeChatHistory();
    if (!userId) return;
    const chatsRef = collection(db, "artifacts", appId, "users", userId, "chats");
    const q = query(chatsRef);
    unsubscribeChatHistory = onSnapshot(q, (snapshot) => {
        const chats = [];
        snapshot.forEach(doc => chats.push({ id: doc.id, ...doc.data() }));
        chats.sort((a, b) => (b.updatedAt?.toMillis() || 0) - (a.updatedAt?.toMillis() || 0));
        renderChatHistory(chats);
    });
}

function renderChatHistory(chats) {
    chatHistoryList.innerHTML = '';
    if (chats.length === 0) {
        chatHistoryList.innerHTML = `<li style="color: var(--subheading-color); text-align: center; font-size: 0.9rem;">No recent chats</li>`;
        return;
    }
    chats.forEach(chat => {
        const li = document.createElement('li');
        li.dataset.chatId = chat.id;
        li.textContent = chat.title || 'Untitled Chat';
        li.onclick = () => loadChat(chat.id);
        if (chat.id === activeChatId) {
            li.classList.add('active');
        }
        chatHistoryList.appendChild(li);
    });
}

function updateActiveChatInSidebar() {
    document.querySelectorAll('#chat-history-list li').forEach(li => {
        li.classList.toggle('active', li.dataset.chatId === activeChatId);
    });
    const activeChat = document.querySelector(`#chat-history-list li[data-chat-id="${activeChatId}"]`);
    mobileChatTitle.textContent = activeChat ? activeChat.textContent : 'Alexr AI';
}

function appendMessage(className, innerHTML, loadingClass = '') {
    const div = document.createElement("div");
    div.classList.add("message", className, loadingClass);
    div.innerHTML = innerHTML;
    chatsContainer.appendChild(div);
    scrollToBottom();
    return div;
}

function createUserMessageHTML(message, file = {}) {
    return `
        <div class="message-content">
            <p class="message-text">${message}</p>
            ${file.data ? (file.isImage ? `<img src="data:${file.mime_type};base64,${file.data}" class="img-attachment" />` : `<p class="file-attachment"><span class="material-symbols-rounded">description</span>${file.fileName}</p>`) : ""}
        </div>
        <img class="avatar" src="assets/user.png" />
    `;
}

function createBotMessageHTML(message) {
    return `<img class="avatar" src="assets/gemini.png" /> <p class="message-text">${message}</p>`;
}

function typingEffect(text, textElement, botMsgDiv) {
    textElement.textContent = "";
    const words = text.split(" ");
    let wordIndex = 0;
    typingInterval = setInterval(() => {
        if (wordIndex < words.length) {
            textElement.textContent += (wordIndex === 0 ? "" : " ") + words[wordIndex++];
            scrollToBottom();
        } else {
            clearInterval(typingInterval);
            botMsgDiv.classList.remove("loading");
        }
    }, 40);
}

const scrollToBottom = () => container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });

function stopResponseGeneration() {
    controller?.abort();
    clearInterval(typingInterval);
    const loadingMessage = chatsContainer.querySelector(".bot-message.loading");
    if (loadingMessage) {
        loadingMessage.classList.remove("loading");
        loadingMessage.querySelector('.message-text').textContent = "Response stopped.";
    }
    document.body.classList.remove("bot-responding");
}

function handleFileSelection() {
    const file = fileInput.files[0];
    if (!file) return;
    const isImage = file.type.startsWith("image/");
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
        fileInput.value = "";
        const base64String = e.target.result.split(",")[1];
        fileUploadWrapper.querySelector(".file-preview").src = e.target.result;
        fileUploadWrapper.classList.add("active", isImage ? "img-attached" : "file-attached");
        userData.file = { fileName: file.name, data: base64String, mime_type: file.type, isImage };
    };
}

function clearFileAttachment() {
    userData.file = {};
    fileUploadWrapper.classList.remove("file-attached", "img-attached", "active");
}

function initializeTheme() {
    const isLightTheme = localStorage.getItem("themeColor") === "light_mode";
    document.body.classList.toggle("light-theme", isLightTheme);
    themeToggleBtn.textContent = isLightTheme ? "dark_mode" : "light_mode";
}

function toggleTheme() {
    const isLightTheme = document.body.classList.toggle("light-theme");
    localStorage.setItem("themeColor", isLightTheme ? "light_mode" : "dark_mode");
    themeToggleBtn.textContent = isLightTheme ? "dark_mode" : "light_mode";
}

main();
