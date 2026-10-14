import { createRoot } from 'react-dom/client';
import Home from '../app/page';
import { AccountGate } from '../components/account-gate';
import { useSearchParams } from './navigation';
import '../app/globals.css';
function App() {
  const params = useSearchParams();
  return (
    <AccountGate>
      <Home bugId={params.get('issue') ?? undefined} />
    </AccountGate>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
