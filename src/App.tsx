import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "./components/Layout";
import Roster from "./pages/Roster";
import PlayerDetail from "./pages/PlayerDetail";
import TeamTotals from "./pages/TeamTotals";
import Schedule from "./pages/Schedule";
import UploadStats from "./pages/UploadStats";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Roster />} />
            <Route path="/player/:id" element={<PlayerDetail />} />
            <Route path="/team" element={<TeamTotals />} />
            <Route path="/schedule" element={<Schedule />} />
            <Route path="/upload" element={<UploadStats />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
