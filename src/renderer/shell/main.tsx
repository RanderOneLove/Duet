import { createRoot } from 'react-dom/client'
import '../shared/fonts.css'
import '../shared/tokens.css'
import './shell.css'
import './screens.css'
import './parts.css'
import './parts2.css'
import './parts4.css'
import './parts5.css'
import './home2.css'
import './jamroom.css'
import './recap.css'
import '../shared/motion.css'
import { App } from './App'
import { RecapCardPage } from './components/RecapCard'

// Невидимое окно карточки итогов грузит ту же оболочку, но рисует одну карточку.
const card = new URLSearchParams(location.search).has('card')

createRoot(document.getElementById('root') as HTMLElement).render(card ? <RecapCardPage /> : <App />)
