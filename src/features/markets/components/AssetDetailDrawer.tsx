import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import { CryptoOnChainMetrics } from "./CryptoOnChainMetrics";
import { MultiTimeframeConsensus } from "./MultiTimeframeConsensus";
import { robinhoodLinkForSignal } from "@/lib/robinhood-links";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  asset: string;
  assetType: "stock" | "crypto";
}

export function AssetDetailDrawer({ open, onOpenChange, asset, assetType }: Props) {
  const rh = robinhoodLinkForSignal({ asset, assetKind: assetType });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="font-display text-2xl">{asset.toUpperCase()}</span>
            <span className="text-xs uppercase tracking-wider text-muted-foreground">{assetType}</span>
          </SheetTitle>
        </SheetHeader>

        <div className="mt-5 space-y-4">
          <MultiTimeframeConsensus asset={asset} assetType={assetType} />

          {assetType === "crypto" && <CryptoOnChainMetrics asset={asset} />}

          <div className="flex flex-col gap-2">
            <a href={rh.url} target="_blank" rel="noreferrer" className="w-full">
              <Button className="w-full" variant="default">
                <ExternalLink className="w-4 h-4 mr-2" />
                {rh.label}
              </Button>
            </a>
            {assetType === "stock" && (
              <a
                href={robinhoodLinkForSignal({ asset, assetKind: "options" }).url}
                target="_blank"
                rel="noreferrer"
                className="w-full"
              >
                <Button className="w-full" variant="outline">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Options chain
                </Button>
              </a>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
