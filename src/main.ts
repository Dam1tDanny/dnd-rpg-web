// Entry point: styles + App boot.
import "./style.css";
import { App } from "./ui/app.js";

const root = document.getElementById("app");
if (!root) throw new Error("#app element missing from index.html");

new App(root).start();
