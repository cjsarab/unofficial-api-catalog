import { mount } from "svelte";
import App from "./App.svelte";
import "./styles/theme.css";

const target = document.getElementById("app");
if (!target) throw new Error("app mount point #app missing from index.html");

export default mount(App, { target });
