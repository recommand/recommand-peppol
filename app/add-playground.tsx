import { useEffect, useState } from "react";
import { useMenuItemActions } from "@core/lib/menu-store";
import { ToyBrick } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@core/components/ui/dialog";
import { Label } from "@core/components/ui/label";
import { Input } from "@core/components/ui/input";
import { Button } from "@core/components/ui/button";
import { Checkbox } from "@core/components/ui/checkbox";
import { toast } from "@core/components/ui/sonner";
import { stringifyActionFailure } from "@recommand/lib/utils";
import { useUserStore } from "@core/lib/user-store";
import { createPlayground } from "@peppol/lib/client/playgrounds";
import { useTranslation } from "@core/hooks/use-translation";

export default function AddPlayground() {
    const { t } = useTranslation();
    const { registerMenuItem } = useMenuItemActions();
    const [isOpen, setIsOpen] = useState(false);
    const [newPlaygroundName, setNewPlaygroundName] = useState("");
    const [useTestNetwork, setUseTestNetwork] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const fetchUser = useUserStore(x => x.fetchUser);
    const setActiveTeam = useUserStore(x => x.setActiveTeam);

    const handleCreatePlayground = async () => {
        if (isCreating) return;

        if (!newPlaygroundName.trim()) {
            toast.error(t`Please enter a name for the playground`);
            return;
        }

        setIsCreating(true);
        try{
            const response = await createPlayground(newPlaygroundName.trim(), useTestNetwork);
            if (!response.success) {
                toast.error(stringifyActionFailure(response.errors));
                return;
            }

            // Refresh the user data such that the new team is available and the onboarding steps are completed
            await fetchUser();

            setActiveTeam(response.playground.id);

            setIsOpen(false);
            setNewPlaygroundName("");
            setUseTestNetwork(false);
            toast.success(t`Playground created successfully`);
        }catch(error){
            toast.error(t`Failed to create playground`);
            console.error(error);
        } finally {
            setIsCreating(false);
        }
    };

    useEffect(() => {
        registerMenuItem({
            id: "team.add-playground",
            title: t`Add playground`,
            icon: ToyBrick,
            onClick: () => {
                setIsOpen(true);
            },
        });
    }, [registerMenuItem, t]);
    return <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>{t`Add playground`}</DialogTitle>
                <DialogDescription>
                    {t`Create a new playground to test your Peppol API integrations.`}
                </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                    <Label>{t`Playground name`}</Label>
                    <Input 
                        value={newPlaygroundName}
                        onChange={(e) => setNewPlaygroundName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                handleCreatePlayground();
                            }
                        }}
                    />
                </div>
                <div className="flex items-start gap-3">
                    <Checkbox 
                        id="use-test-network"
                        checked={useTestNetwork}
                        onCheckedChange={(checked) => setUseTestNetwork(checked === true)}
                    />
                    <div className="grid gap-1.5">
                        <Label htmlFor="use-test-network" className="cursor-pointer">
                            {t`Use Peppol Test Network`}
                        </Label>
                        <p className="text-sm text-muted-foreground">
                            {t`When checked, you are able to send and receive documents over the Peppol Test Network, allowing communication with external Peppol participants. Do not enable this setting if you are not sure what you are doing. This setting cannot be changed after playground creation.`}
                        </p>
                    </div>
                </div>
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => setIsOpen(false)}>{t`Cancel`}</Button>
                <Button onClick={handleCreatePlayground} disabled={isCreating || !newPlaygroundName.trim()}>{t`Create playground`}</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>;
}
