import { useRoute } from './lib/router';
import Drills from './pages/Drills';
import IncidentDetail from './pages/IncidentDetail';
import Incidents from './pages/Incidents';
import Network from './pages/Network';
import Overview from './pages/Overview';
import Reports from './pages/Reports';
import Services from './pages/Services';
import Settings from './pages/Settings';
import { FlowGuardProvider } from './state/store';
import { Shell } from './ui/Shell';

function Page({ route }: { route: string[] }) {
  switch (route[0]) {
    case 'incidents':
      return route[1] ? <IncidentDetail id={route[1]} /> : <Incidents />;
    case 'network':
      return <Network />;
    case 'services':
      return <Services />;
    case 'drills':
      return <Drills />;
    case 'reports':
      return <Reports />;
    case 'settings':
      return <Settings tab={route[1] ?? 'protection'} />;
    default:
      return <Overview />;
  }
}

export default function App() {
  const route = useRoute();
  return (
    <FlowGuardProvider>
      <Shell route={route}>
        <Page route={route} />
      </Shell>
    </FlowGuardProvider>
  );
}
