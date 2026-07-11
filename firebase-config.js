// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyB8eKU6gZTQ1BMjfmtVwDtbl76f3SsSjmI",
  authDomain: "tution-ce289.firebaseapp.com",
  databaseURL: "https://tution-ce289-default-rtdb.firebaseio.com",
  projectId: "tution-ce289",
  storageBucket: "tution-ce289.firebasestorage.app",
  messagingSenderId: "3234005964",
  appId: "1:3234005964:web:88375ee0c783098f7ed369"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);