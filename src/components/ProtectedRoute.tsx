import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/contexts/auth";

const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { session, isCoach, loading, signOut } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  }
  if (!session) return <Navigate to="/login" replace />;

  // Authenticated but coach lookup hasn't resolved yet — keep waiting.
  if (isCoach === null) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Verifying access…</div>;
  }

  if (!isCoach) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <Card className="p-8 max-w-md w-full text-center">
          <ShieldAlert className="w-10 h-10 mx-auto mb-3 text-sa-orange" />
          <h2 className="font-display text-2xl text-sa-blue-deep mb-2">Not authorized</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Your email isn't on the coach list. Ask an existing coach to add you.
          </p>
          <Button onClick={signOut} variant="outline" className="w-full">Sign out</Button>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
};

export default ProtectedRoute;
