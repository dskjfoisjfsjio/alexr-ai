// --- DOM Element Selections ---
const container = document.querySelector(".container");
const chatsContainer = document.querySelector(".chats-container");
const promptForm = document.querySelector(".prompt-form");
const promptInput = promptForm.querySelector(".prompt-input");
const fileInput = promptForm.querySelector("#file-input");
const fileUploadWrapper = promptForm.querySelector(".file-upload-wrapper");
const themeToggleBtn = document.querySelector("#theme-toggle-btn");
const deleteChatsBtn = document.querySelector("#delete-chats-btn");

// Sidebar elements
const sidebar = document.querySelector('.sidebar');
const openSidebarBtn = document.querySelector('#open-sidebar-btn');
const closeSidebarBtn = document.querySelector('#close-sidebar-btn');
const newChatBtn = document.querySelector('#new-chat-btn');
const chatHistoryList = document.querySelector('#chat-history-list');
const userIdDisplay = document.querySelector('#user-id-display');
const mobileChatTitle = document.querySelector('.mobile-chat-title');
const themeToggleBtnSidebar = document.querySelector("#theme-toggle-btn-sidebar");

// --- App State ---
let controller, typingInterval;
let userData = { message: "", file: {} };

// --- Firebase State ---
let db, auth;
let userId;
let activeChatId = null;
let unsubscribeChatHistory = null;
let localChatHistory = []; // A local cache of the user's chat history

// --- Firebase Configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyBKXGnD5es5lQq6Jz4JcXaliAp6cahSIKg",
  authDomain: "alexr-ai.firebaseapp.com",
  projectId: "alexr-ai",
  storageBucket: "alexr-ai.firebasestorage.app",
  messagingSenderId: "1027395139056",
  appId: "1:1027395139056:web:211f297774a1a38c2d1935"
};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-alexr-ai-app';

// ===================================================================
// START: USER'S ORIGINAL CODE (with minimal, necessary modifications)
// ===================================================================

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

// **UNCHANGED** This is your core function that calls the backend.
const generateResponse = async (botMsgDiv) => {
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

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! Status: ${response.status}, Message: ${errorText}`);
        }

        const responseData = await response.json();
        const responseText = responseData?.response || "No response received.";

        typingEffect(responseText, textElement, botMsgDiv);
        
        // **MODIFICATION**: Instead of saving to localStorage, we now save the bot's response to Firestore.
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

// **MODIFIED** This function now saves the user's message to Firestore before calling your generateResponse function.
const handleFormSubmit = async (e) => {
    e.preventDefault();
    const userMessage = promptInput.value.trim();
    if (!userMessage || document.body.classList.contains("bot-responding")) return;

    userData.message = userMessage;
    promptInput.value = "";
    document.body.classList.add("chats-active", "bot-responding");
    fileUploadWrapper.classList.remove("file-attached", "img-attached", "active");

    const userMsgHTML = `
        <p class="message-text"></p>
        ${userData.file.data ? (userData.file.isImage ? `<img src="data:${userData.file.mime_type};base64,${userData.file.data}" class="img-attachment" />` : `<p class="file-attachment"><span class="material-symbols-rounded">description</span>${userData.file.fileName}</p>`) : ""}
    `;
    const userMsgDiv = createMessageElement(userMsgHTML, "user-message");
    userMsgDiv.querySelector(".message-text").textContent = userData.message;
    chatsContainer.appendChild(userMsgDiv);
    scrollToBottom();

    // **MODIFICATION**: Save user message to Firestore. This will create a new chat if one isn't active.
    await saveMessageToFirestore('user', userMessage);

    setTimeout(() => {
        const botMsgHTML = `<img class="avatar" src="assets/gemini.png" /> <p class="message-text">Just a sec...</p>`;
        const botMsgDiv = createMessageElement(botMsgHTML, "bot-message", "loading");
        chatsContainer.appendChild(botMsgDiv);
        scrollToBottom();
        generateResponse(botMsgDiv);
    }, 600);
};

// ===================================================================
// END: USER'S ORIGINAL CODE
// ===================================================================


// ===================================================================
// START: NEW SIDEBAR & FIREBASE LOGIC
// ===================================================================

/**
 * Saves a message (from user or assistant) to the active chat in Firestore.
 * Creates a new chat document if one doesn't exist.
 */
async function saveMessageToFirestore(role, content) {
    if (!userId) return;

    try {
        let chatRef;
        let isNewChat = false;
        const chatsCollection = db.collection("artifacts").doc(appId).collection("users").doc(userId).collection("chats");

        if (activeChatId) {
            chatRef = chatsCollection.doc(activeChatId);
        } else {
            isNewChat = true;
            chatRef = chatsCollection.doc(); // Let Firestore generate the ID
            activeChatId = chatRef.id;
        }

        const chatDoc = await chatRef.get();
        const currentMessages = chatDoc.exists ? chatDoc.data().messages : [];
        const newMessages = [...currentMessages, { role, content }];
        
        const payload = {
            messages: newMessages,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        };

        if (isNewChat) {
            payload.title = content.substring(0, 35) + (content.length > 35 ? '...' : '');
        }

        await chatRef.set(payload, { merge: true });

    } catch (error) {
        console.error("Error saving message to Firestore:", error);
    }
}

/**
 * Sets up a real-time listener for the user's chat history and updates the sidebar.
 */
function listenForChatHistory() {
    if (unsubscribeChatHistory) unsubscribeChatHistory();
    if (!userId) return;

    const chatsRef = db.collection("artifacts").doc(appId).collection("users").doc(userId).collection("chats");
    
    unsubscribeChatHistory = chatsRef.orderBy("updatedAt", "desc").onSnapshot((snapshot) => {
        localChatHistory = [];
        snapshot.forEach(doc => localChatHistory.push({ id: doc.id, ...doc.data() }));
        renderChatHistory();
    }, (error) => console.error("Error listening to chat history:", error));
}

/**
 * Renders the sidebar list from the `localChatHistory` cache.
 */
function renderChatHistory() {
    chatHistoryList.innerHTML = '';
    if (localChatHistory.length === 0) {
        chatHistoryList.innerHTML = `<li style="color: var(--subheading-color); text-align: center; font-size: 0.9rem; padding: 10px;">No recent chats</li>`;
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

/**
 * Clears the main screen to start a new conversation.
 */
function startNewChat() {
    activeChatId = null;
    chatsContainer.innerHTML = "";
    document.body.classList.remove("chats-active");
    promptInput.focus();
    updateActiveChatInSidebar();
    if (window.innerWidth <= 768) sidebar.classList.remove('open');
}

/**
 * Loads a selected chat from history into the main view.
 */
async function loadChat(chatId) {
    if (!userId || activeChatId === chatId) return;
    activeChatId = chatId;
    
    const chatData = localChatHistory.find(c => c.id === chatId);
    if (chatData) {
        chatsContainer.innerHTML = '';
        chatData.messages.forEach(msg => {
            let messageEl;
            if (msg.role === 'user') {
                const userMsgHTML = `<p class="message-text"></p>`;
                messageEl = createMessageElement(userMsgHTML, "user-message");
                messageEl.querySelector(".message-text").textContent = msg.content;
            } else {
                const botMsgHTML = `<img class="avatar" src="assets/gemini.png" /> <p class="message-text">${msg.content}</p>`;
                messageEl = createMessageElement(botMsgHTML, "bot-message");
            }
            chatsContainer.appendChild(messageEl);
        });
        document.body.classList.add("chats-active");
        updateActiveChatInSidebar();
        scrollToBottom();
        if (window.innerWidth <= 768) sidebar.classList.remove('open');
    }
}

/**
 * Highlights the active chat in the sidebar list.
 */
function updateActiveChatInSidebar() {
    document.querySelectorAll('#chat-history-list li').forEach(li => {
        li.classList.toggle('active', li.dataset.chatId === activeChatId);
    });
    const activeChatItem = localChatHistory.find(c => c.id === activeChatId);
    mobileChatTitle.textContent = activeChatItem ? activeChatItem.title : 'Alexr AI';
}

/**
 * Handles Firebase authentication, creating an anonymous user if needed.
 */
async function setupAuthentication() {
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            userId = user.uid;
            userIdDisplay.textContent = userId;
            listenForChatHistory();
        } else {
             try {
                if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                    await auth.signInWithCustomToken(__initial_auth_token);
                } else {
                    await auth.signInAnonymously();
                }
            } catch (error) {
                console.error("Authentication Error:", error);
                alert("Could not connect to the chat service. Please refresh the page.");
            }
        }
    });
}

// ===================================================================
// END: NEW SIDEBAR & FIREBASE LOGIC
// ===================================================================

// ===================================================================
// START: INITIALIZATION AND EVENT LISTENERS
// ===================================================================
function main() {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    auth = firebase.auth();
    
    setupAuthentication();

    // --- Original Event Listeners (preserved) ---
    promptForm.addEventListener("submit", handleFormSubmit);

    const toggleTheme = () => {
        const isLightTheme = document.body.classList.toggle("light-theme");
        localStorage.setItem("themeColor", isLightTheme ? "light_mode" : "dark_mode");
        const themeIcon = isLightTheme ? "dark_mode" : "light_mode";
        themeToggleBtn.textContent = themeIcon;
        themeToggleBtnSidebar.textContent = themeIcon;
    };
    themeToggleBtn.addEventListener("click", toggleTheme);
    themeToggleBtnSidebar.addEventListener("click", toggleTheme);

    fileInput.addEventListener("change", () => {
        const file = fileInput.files[0]; if (!file) return; const isImage = file.type.startsWith("image/");
        const reader = new FileReader(); reader.readAsDataURL(file);
        reader.onload = (e) => {
            fileInput.value = ""; const base64String = e.target.result.split(",")[1];
            fileUploadWrapper.querySelector(".file-preview").src = e.target.result;
            fileUploadWrapper.classList.add("active", isImage ? "img-attached" : "file-attached");
            userData.file = { fileName: file.name, data: base64String, mime_type: file.type, isImage };
        };
    });

    document.querySelector("#cancel-file-btn").addEventListener("click", () => {
        userData.file = {}; fileUploadWrapper.classList.remove("file-attached", "img-attached", "active");
    });

    document.querySelector("#stop-response-btn").addEventListener("click", () => {
        controller?.abort(); userData.file = {}; clearInterval(typingInterval);
        const loadingMessage = chatsContainer.querySelector(".bot-message.loading");
        if (loadingMessage) loadingMessage.classList.remove("loading");
        document.body.classList.remove("bot-responding");
    });

    deleteChatsBtn.addEventListener("click", () => {
        chatsContainer.innerHTML = "";
        if (!activeChatId) {
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

    // --- New Sidebar Event Listeners ---
    newChatBtn.addEventListener('click', startNewChat);
    openSidebarBtn.addEventListener('click', () => sidebar.classList.add('open'));
    closeSidebarBtn.addEventListener('click', () => sidebar.classList.remove('open'));

    // Set initial theme from localStorage
    const isLightTheme = localStorage.getItem("themeColor") === "light_mode";
    document.body.classList.toggle("light-theme", isLightTheme);
    const themeIcon = isLightTheme ? "dark_mode" : "light_mode";
    themeToggleBtn.textContent = themeIcon;
    themeToggleBtnSidebar.textContent = themeIcon;
}

main();
