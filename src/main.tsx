import { render } from 'solid-js/web'
import { App } from './App'
import '@/styles/index.css'
import 'pdfjs-dist/web/pdf_viewer.css'

render(() => <App />, document.getElementById('root')!)
