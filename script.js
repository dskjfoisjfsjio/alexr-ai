// --- Firebase SDK Imports ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, collection, query, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";


// --- DOM Element Selection ---
const container = document.querySelector(".container");
const chatsContainer = document.querySelector(".chats-container");
const promptForm = document.querySelector(".prompt-form");
const promptInput = promptForm.querySelector(".prompt-input");
const fileInput = promptForm.querySelector("#file-input");
const fileUploadWrapper = promptForm.querySelector(".file-upload-wrapper");
const themeToggleBtn = document.querySelector("#theme-toggle-btn");
const themeToggleBtnSidebar = document.querySelector("#theme-toggle-btn-sidebar");
const deleteChatsBtn = document.querySelector("#delete-chats-btn");

// Sidebar elements
const sidebar = document.querySelector('.sidebar');
const openSidebarBtn = document.querySelector('#open-sidebar-btn');
const closeSidebarBtn = document.querySelector('#close-sidebar-btn');
const newChatBtn = document.querySelector('#new-chat-btn');
const chatHistoryList = document.querySelector('#chat-history-list');
const userIdDisplay = document.querySelector('#user-id-display');
const mobileChatTitle = document.querySelector('.mobile-chat-title');


// --- App State ---
let controller, typingInterval;
let userData = { message: "", file: {} };

// --- Firebase State ---
let db, auth;
let userId;
let activeChatId = null;
let unsubscribeChatHistory = null;
let localChatHistory = []; // Local cache of chat objects

// --- Firebase Configuration ---
// IMPORTANT: Replace with your actual Firebase config
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


// --- YOUR ORIGINAL CODE (with minor adaptations) ---

const createMessageElement = (content, ...classes) => {
    const div = document.createElement("div");
    div.classList.add("message", ...classes);
    div.innerHTML = content;
    return div;
};

const scrollToBottom = () => container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });

const typingEffect = (text, textElement, botMsgDiv) => {
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
            document.body.classList.remove("bot-responding");
        }
    }, 40);
};

// THIS IS YOUR CORE BACKEND FUNCTION - UNCHANGED
const generateResponse = async (botMsgDiv) => {
    const textElement = botMsgDiv.querySelector(".message-text");
    controller = new AbortController();

    // The new code will push to a Firestore-managed array, not this local one.
    // This local `chatHistory` is no longer the source of truth for persistence.
    const localHistoryForApi = [{
        role: "user",
        parts: [{ text: userData.message }, ...(userData.file.data ? [{ inline_data: (({ fileName, isImage, ...rest }) => rest)(userData.file) }] : [])],
    }];

    try {
        botMsgDiv.classList.add("loading");

        const response = await fetch('https://alexr-ai.onrender.com/generate-response', {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: userData.message }), // Your backend expects `prompt`
            signal: controller.signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! Status: ${response.status}, Message: ${errorText}`);
        }

        const responseData = await response.json();
        const responseText = responseData?.response || "No response received.";

        typingEffect(responseText, textElement, botMsgDiv);

        // --- MODIFICATION: Save bot response to Firestore ---
        await saveMessageToFirestore('assistant', responseText);
        
    } catch (error) {
        textElement.textContent = error.name === "AbortError" ? "Response generation stopped." : error.message;
        textElement.style.color = "#d62939";
        botMsgDiv.classList.remove("loading");
        document.body.classList.remove("bot-responding");
        scrollToBottom();
    } finally {
        userData.file = {};
    }
};

const handleFormSubmit = async (e) => {
    e.preventDefault();
    const userMessage = promptInput.value.trim();
    if (!userMessage || document.body.classList.contains("bot-responding")) return;

    userData.message = userMessage;
    promptInput.value = "";
    document.body.classList.add("chats-active", "bot-responding");
    fileUploadWrapper.classList.remove("file-attached", "img-attached", "active");

    const userMsgHTML = `
        <p class="message-text">${userData.message}</p>
        ${userData.file.data ? (userData.file.isImage ? `<img src="data:${userData.file.mime_type};base64,${userData.file.data}" class="img-attachment" />` : `<p class="file-attachment"><span class="material-symbols-rounded">description</span>${userData.file.fileName}</p>`) : ""}
    `;
    const userMsgDiv = createMessageElement(userMsgHTML, "user-message");
    chatsContainer.appendChild(userMsgDiv);
    scrollToBottom();

    // --- MODIFICATION: Save user message to Firestore before generating response ---
    await saveMessageToFirestore('user', userData.message);
    
    // This timeout can be kept if desired
    setTimeout(() => {
        const botMsgHTML = `<img class="avatar" src="assets/gemini.png" /> <p class="message-text">Just a sec...</p>`;
        const botMsgDiv = createMessageElement(botMsgHTML, "bot-message", "loading");
        chatsContainer.appendChild(botMsgDiv);
        scrollToBottom();
        generateResponse(botMsgDiv);
    }, 600);
};

// --- NEW FIREBASE-RELATED FUNCTIONS ---

async function saveMessageToFirestore(role, content) {
    if (!userId) return;

    try {
        let chatRef;
        let isNewChat = false;

        if (activeChatId) {
            chatRef = doc(db, "artifacts", appId, "users", userId, "chats", activeChatId);
        } else {
            isNewChat = true;
            chatRef = doc(collection(db, "artifacts", appId, "users", userId, "chats"));
            activeChatId = chatRef.id;
        }

        const chatDoc = await getDoc(chatRef);
        const currentMessages = chatDoc.exists() ? chatDoc.data().messages : [];
        const newMessages = [...currentMessages, { role, content }];
        
        const payload = {
            messages: newMessages,
            updatedAt: serverTimestamp(),
        };

        if (isNewChat) {
            payload.title = content.substring(0, 40) + (content.length > 40 ? '...' : '');
        }

        await setDoc(chatRef, payload, { merge: true });

    } catch (error) {
        console.error("Error saving message to Firestore:", error);
    }
}

function listenForChatHistory() {
    if (unsubscribeChatHistory) unsubscribeChatHistory();
    if (!userId) return;

    const chatsRef = collection(db, "artifacts", appId, "users", userId, "chats");
    const q = query(chatsRef);

    unsubscribeChatHistory = onSnapshot(q, (snapshot) => {
        localChatHistory = [];
        snapshot.forEach(doc => localChatHistory.push({ id: doc.id, ...doc.data() }));
        localChatHistory.sort((a, b) => (b.updatedAt?.toMillis() || 0) - (a.updatedAt?.toMillis() || 0));
        renderChatHistory();
    }, (error) => console.error("Error listening to chat history:", error));
}

function renderChatHistory() {
    chatHistoryList.innerHTML = '';
    if (localChatHistory.length === 0) {
        chatHistoryList.innerHTML = `<li style="color: var(--subheading-color); text-align: center; font-size: 0.9rem;">No recent chats</li>`;
        return;
    }
    localChatHistory.forEach(chat => {
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

function startNewChat() {
    activeChatId = null;
    chatsContainer.innerHTML = "";
    document.body.classList.remove("chats-active");
    promptInput.focus();
    updateActiveChatInSidebar();
    if (window.innerWidth <= 768) sidebar.classList.remove('open');
}

async function loadChat(chatId) {
    if (!userId || activeChatId === chatId) return;
    activeChatId = chatId;
    
    const chatData = localChatHistory.find(c => c.id === chatId);
    if (chatData) {
        chatsContainer.innerHTML = '';
        chatData.messages.forEach(msg => {
            const html = msg.role === 'user' ? `<p class="message-text">${msg.content}</p>` : `<img class="avatar" src="assets/gemini.png" /> <p class="message-text">${msg.content}</p>`;
            const messageEl = createMessageElement(html, `${msg.role}-message`);
            chatsContainer.appendChild(messageEl);
        });
        document.body.classList.add("chats-active");
        updateActiveChatInSidebar();
        scrollToBottom();
        if (window.innerWidth <= 768) sidebar.classList.remove('open');
    }
}

function updateActiveChatInSidebar() {
    document.querySelectorAll('#chat-history-list li').forEach(li => {
        li.classList.toggle('active', li.dataset.chatId === activeChatId);
    });
    const activeChatItem = localChatHistory.find(c => c.id === activeChatId);
    mobileChatTitle.textContent = activeChatItem ? activeChatItem.title : 'Alexr AI';
}


async function setupAuthentication() {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            userId = user.uid;
            userIdDisplay.textContent = userId;
            listenForChatHistory();
        } else {
             try {
                if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                    await signInWithCustomToken(auth, __initial_auth_token);
                } else {
                    await signInAnonymously(auth);
                }
            } catch (error) {
                console.error("Authentication Error:", error);
            }
        }
    });
}


// --- Event Listeners & Initialization ---

// Initialize theme from localStorage
const initializeTheme = () => {
    const isLightTheme = localStorage.getItem("themeColor") === "light_mode";
    document.body.classList.toggle("light-theme", isLightTheme);
    const themeIcon = isLightTheme ? "dark_mode" : "light_mode";
    themeToggleBtn.textContent = themeIcon;
    themeToggleBtnSidebar.textContent = themeIcon;
};

const toggleTheme = () => {
    const isLightTheme = document.body.classList.toggle("light-theme");
    localStorage.setItem("themeColor", isLightTheme ? "light_mode" : "dark_mode");
    const themeIcon = isLightTheme ? "dark_mode" : "light_mode";
    themeToggleBtn.textContent = themeIcon;
    themeToggleBtnSidebar.textContent = themeIcon;
};

// --- Initialize App ---
function main() {
    db = getFirestore(app);
    auth = getAuth(app);
    
    initializeTheme();
    setupAuthentication();

    // Your original event listeners
    promptForm.addEventListener("submit", handleFormSubmit);
    themeToggleBtn.addEventListener("click", toggleTheme);
    themeToggleBtnSidebar.addEventListener("click", toggleTheme);

    fileInput.addEventListener("change", () => {
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
    });

    document.querySelector("#cancel-file-btn").addEventListener("click", () => {
        userData.file = {};
        fileUploadWrapper.classList.remove("file-attached", "img-attached", "active");
    });

    document.querySelector("#stop-response-btn").addEventListener("click", () => {
        controller?.abort();
        userData.file = {};
        clearInterval(typingInterval);
        const loadingMessage = chatsContainer.querySelector(".bot-message.loading");
        if (loadingMessage) loadingMessage.classList.remove("loading");
        document.body.classList.remove("bot-responding");
    });

    deleteChatsBtn.addEventListener("click", () => {
        // This button now clears the *current* chat visually.
        // A separate "delete all" in the sidebar would handle DB operations.
        chatsContainer.innerHTML = "";
        if(!activeChatId) {
             document.body.classList.remove("chats-active", "bot-responding");
        }
    });

    document.querySelectorAll(".suggestions-item").forEach((suggestion) => {
        suggestion.addEventListener("click", () => {
            promptInput.value = suggestion.querySelector(".text").textContent;
            promptForm.dispatchEvent(new Event("submit"));
        });
    });

    promptForm.querySelector("#add-file-btn").addEventListener("click", () => fileInput.click());
    
    // Sidebar Listeners
    newChatBtn.addEventListener('click', startNewChat);
    openSidebarBtn.addEventListener('click', () => sidebar.classList.add('open'));
    closeSidebarBtn.addEventListener('click', () => sidebar.classList.remove('open'));
}

main();
