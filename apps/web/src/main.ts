import { createApp } from 'vue'
import App from './App.vue'
import nodehubIcon from './nodehub.png'
import './styles.css'

document.title = 'NodeHub'

const faviconLink = document.querySelector<HTMLLinkElement>("link[rel='icon']") || document.createElement('link')
faviconLink.rel = 'icon'
faviconLink.type = 'image/png'
faviconLink.href = nodehubIcon
if (!faviconLink.parentNode) {
  document.head.appendChild(faviconLink)
}

createApp(App).mount('#app')
