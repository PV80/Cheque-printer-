import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/Header';
import { UploadZone } from './components/UploadZone';
import { BatchView } from './components/BatchView';
import { PrintQueue } from './components/PrintQueue';
import { CompanySetup } from './components/CompanySetup';

function Main() {
  const { state } = useApp();
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main>
        {state.activeTab === 'upload' && <UploadZone />}
        {state.activeTab === 'batches' && <BatchView />}
        {state.activeTab === 'print' && <PrintQueue />}
        {state.activeTab === 'setup' && <CompanySetup />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Main />
    </AppProvider>
  );
}
