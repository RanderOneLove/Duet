import { createRoot } from 'react-dom/client'
import '../shared/tokens.css'
import './shell.css'
import './screens.css'
import './parts.css'
import './parts2.css'
import './parts3.css'
import './parts4.css'
import './parts5.css'
import { App } from './App'

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
