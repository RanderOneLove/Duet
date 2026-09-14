import { createRoot } from 'react-dom/client'
import '../shared/tokens.css'
import '../shell/parts2.css'
import './mini.css'
import { App } from './App'

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
