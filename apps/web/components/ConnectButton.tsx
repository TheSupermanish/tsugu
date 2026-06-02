"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { shannon } from "@asom/sdk";
import { shortAddr } from "@/lib/vault";

export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const injected = connectors.find((c) => c.type === "injected") ?? connectors[0];
  const wrong = isConnected && chainId !== undefined && chainId !== shannon.id;

  if (wrong) {
    return (
      <button onClick={() => switchChain({ chainId: shannon.id })} className="btn-ghost border-amber-500/50 text-amber-200">
        Wrong network — switch to Somnia
      </button>
    );
  }
  if (isConnected && address) {
    return (
      <button onClick={() => disconnect()} className="btn-ghost font-mono text-xs" title="Disconnect">
        <span className="h-1.5 w-1.5 rounded-full bg-jade" /> {shortAddr(address)}
      </button>
    );
  }
  return (
    <button onClick={() => injected && connect({ connector: injected })} disabled={!injected || isPending} className="btn-gold">
      {isPending ? "Connecting…" : "Connect wallet"}
    </button>
  );
}
