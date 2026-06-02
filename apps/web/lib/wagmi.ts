import { http, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { shannon } from "@asom/sdk";

/** Public RPC used for reads (overridable for a private/rate-limited endpoint). */
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://dream-rpc.somnia.network";

/** wagmi config: Somnia Shannon + an injected (browser) wallet. Self-custodial —
 *  the user signs every write with their own wallet; asom never holds a key. */
export const wagmiConfig = createConfig({
  chains: [shannon],
  connectors: [injected()],
  transports: { [shannon.id]: http(RPC_URL) },
  ssr: true,
});
