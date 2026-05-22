import { Route, Routes } from "react-router-dom";
import { SessionsPage } from "./pages/SessionsPage";
import { SessionOverviewPage } from "./pages/SessionOverviewPage";
import { RequestDetailPage } from "./pages/RequestDetailPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<SessionsPage />} />
      <Route path="/session/:id" element={<SessionOverviewPage />} />
      <Route
        path="/session/:id/request/:reqId"
        element={<RequestDetailPage />}
      />
      <Route path="*" element={<SessionsPage />} />
    </Routes>
  );
}
