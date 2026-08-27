import { useState } from "react";
import { Button } from "@core/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@core/components/ui/dialog";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { toast } from "@core/components/ui/sonner";
import { ToyBrick, Users, ChevronRight } from "lucide-react";
import { stringifyActionFailure } from "@recommand/lib/utils";
import { useUserStore } from "@core/lib/user-store";
import { createPlayground } from "@peppol/lib/client/playgrounds";
import { useTranslation } from "@core/hooks/use-translation";

interface PlaygroundOptionProps {
  /** Optional custom text for the button */
  buttonText?: string;
  /** Optional custom description for the dialog */
  description?: string;
}

export default function PlaygroundOption({ 
  buttonText,
  description
}: PlaygroundOptionProps) {
  const { t } = useTranslation();
  const resolvedButtonText = buttonText ?? t`Switch Team or Create Playground`;
  const resolvedDescription = description ?? t`Skip the current setup by switching to another team or creating a playground to test your Peppol API integrations without billing requirements.`;
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [playgroundName, setPlaygroundName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const teams = useUserStore(x => x.teams);
  const activeTeam = useUserStore(x => x.activeTeam);
  const fetchUser = useUserStore(x => x.fetchUser);
  const setActiveTeam = useUserStore(x => x.setActiveTeam);

  // Get other teams (excluding the current active team)
  const otherTeams = teams.filter(team => team.id !== activeTeam?.id);

  const handleCreatePlayground = async () => {
    if (isCreating) return;

    if (!playgroundName.trim()) {
      toast.error(t`Please enter a name for the playground`);
      return;
    }

    setIsCreating(true);
    try {
      const response = await createPlayground(playgroundName.trim(), false);
      if (!response.success) {
        toast.error(stringifyActionFailure(response.errors));
        return;
      }

      // Refresh the user data such that the new team is available and the onboarding steps are completed
      await fetchUser();

      setActiveTeam(response.playground.id);

      setIsDialogOpen(false);
      setPlaygroundName("");
      toast.success(t`Playground created successfully`);
    } catch (error) {
      toast.error(t`Failed to create playground`);
      console.error(error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleSwitchTeam = (teamId: string) => {
    setActiveTeam(teamId);
    setIsDialogOpen(false);
    toast.success(t`Switched team successfully`);
  };

  return (
    <>
      <div className="pt-8">
        <div className="bg-muted/50 border border-muted rounded-lg p-4">
          <div className="flex flex-col items-center space-y-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted">
              <ToyBrick className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="text-center space-y-2">
              <h4 className="text-sm font-medium">{t`Skip Setup with Playground`}</h4>
              <p className="text-sm text-muted-foreground max-w-md text-center text-balance">
                {t`Create a playground to test integrations without billing requirements, or switch to an existing team.`}
              </p>
            </div>
            <Button 
              variant="outline" 
              onClick={() => setIsDialogOpen(true)}
              className="gap-2 text-xs h-8"
              size="sm"
            >
              <Users className="w-3 h-3" />
              {resolvedButtonText}
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t`Switch Team or Create Playground`}</DialogTitle>
            <DialogDescription>
              {resolvedDescription}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Existing Teams Section */}
            {otherTeams.length > 0 && (
              <div className="grid gap-2">
                <Label className="text-sm font-medium">{t`Switch to existing team`}</Label>
                <div className="space-y-2">
                  {otherTeams.filter((team: any) => team.id !== activeTeam?.id && (team.isMember === true || team.isMember === undefined)).map((team) => (
                    <Button
                      key={team.id}
                      variant="outline"
                      onClick={() => handleSwitchTeam(team.id)}
                      className="w-full justify-between h-auto p-3 text-left"
                    >
                      <div>
                        <div className="font-medium">{team.name}</div>
                        {team.teamDescription && (
                          <div className="text-sm text-muted-foreground">{team.teamDescription}</div>
                        )}
                      </div>
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Create Playground Section */}
            <div className="grid gap-2">
              <Label htmlFor="playground-name">{t`Create new playground`}</Label>
              <Input
                id="playground-name"
                placeholder={t`Playground name`}
                value={playgroundName}
                onChange={(e) => setPlaygroundName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleCreatePlayground();
                  }
                }}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              {t`Cancel`}
            </Button>
            <Button 
              onClick={handleCreatePlayground} 
              disabled={isCreating || !playgroundName.trim()}
            >
              {isCreating ? t`Creating...` : t`Create Playground`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
