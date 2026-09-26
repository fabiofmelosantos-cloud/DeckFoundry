import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import Layout from './components/Layout'
import Home from './pages/Home'
import Collection from './pages/Collection'
import Scanner from './pages/Scanner'
import Discover from './pages/Discover'
import Decks from './pages/Decks'
import DeckView from './pages/DeckView'
import TestDeck from './pages/TestDeck'
import CardView from './pages/CardView'
import Lab from './pages/Lab'
import BuyList from './pages/BuyList'
import WhatsNew from './pages/WhatsNew'
import Profile from './pages/Profile'
import Market from './pages/Market'
import Import from './pages/Import'
import PlayLobby from './pages/PlayLobby'
import PlayRoom from './pages/PlayRoom'
import PlayBot from './pages/PlayBot'
import { loadUserCards } from './lib/userCards'

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/collection', element: <Collection /> },
      { path: '/scan', element: <Scanner /> },
      { path: '/discover', element: <Discover /> },
      { path: '/decks', element: <Decks /> },
      { path: '/deck/:id', element: <DeckView /> },
      { path: '/deck/:id/test', element: <TestDeck /> },
      { path: '/deck/:id/bot', element: <PlayBot /> },
      { path: '/card/:id', element: <CardView /> },
      { path: '/lab', element: <Lab /> },
      { path: '/buy', element: <BuyList /> },
      { path: '/whats-new', element: <WhatsNew /> },
      { path: '/profile', element: <Profile /> },
      { path: '/market', element: <Market /> },
      { path: '/import', element: <Import /> },
      { path: '/play', element: <PlayLobby /> },
      { path: '/play/:code', element: <PlayRoom /> },
      { path: '*', element: <Home /> },
    ],
  },
])

// Imported cards live in IndexedDB; register them before the first render so the
// collection never points at cards the database doesn't know yet.
loadUserCards().finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  ),
)
