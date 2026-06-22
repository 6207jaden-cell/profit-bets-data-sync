import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TrendingUp, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Markets Dashboard" },
      { name: "description", content: "Sign in to access live AI market signals, alerts, watchlists and news." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleEmail(mode: "signin" | "signup") {
    setLoading(true);
    try {
      const fn = mode === "signin" ? supabase.auth.signInWithPassword : supabase.auth.signUp;
      const { error } = await fn.call(supabase.auth, {
        email,
        password,
        ...(mode === "signup" ? { options: { emailRedirectTo: window.location.origin + "/markets" } } : {}),
      } as never);
      if (error) throw error;
      toast.success(mode === "signin" ? "Welcome back." : "Account created — check your email if confirmation is required.");
      navigate({ to: "/markets" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin + "/markets",
      });
      if (result.error) throw result.error;
      if (!result.redirected) navigate({ to: "/markets" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Google sign-in failed");
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md p-8 border-border">
        <Link to="/" className="flex items-center gap-2 mb-6">
          <TrendingUp className="h-6 w-6 text-primary" />
          <span className="font-display font-semibold text-lg">Markets Dashboard</span>
        </Link>
        <h1 className="text-2xl font-display font-semibold mb-1">Welcome</h1>
        <p className="text-sm text-muted-foreground mb-6">Sign in to access live signals and alerts.</p>

        <Button onClick={handleGoogle} disabled={loading} variant="outline" className="w-full mb-4">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue with Google"}
        </Button>

        <div className="relative my-6 text-center text-xs text-muted-foreground">
          <span className="bg-card px-2 relative z-10">or with email</span>
          <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
        </div>

        <Tabs defaultValue="signin">
          <TabsList className="grid grid-cols-2 w-full mb-4">
            <TabsTrigger value="signin">Sign in</TabsTrigger>
            <TabsTrigger value="signup">Sign up</TabsTrigger>
          </TabsList>
          {(["signin", "signup"] as const).map((mode) => (
            <TabsContent key={mode} value={mode} className="space-y-3">
              <div>
                <Label htmlFor={`${mode}-email`}>Email</Label>
                <Input id={`${mode}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </div>
              <div>
                <Label htmlFor={`${mode}-pw`}>Password</Label>
                <Input id={`${mode}-pw`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} />
              </div>
              <Button onClick={() => handleEmail(mode)} disabled={loading || !email || !password} className="w-full">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "signin" ? "Sign in" : "Create account"}
              </Button>
            </TabsContent>
          ))}
        </Tabs>
      </Card>
    </main>
  );
}
