export type WebhookGuardAdapters = {
    seenByWamid: (wamid: string) => Promise<boolean>;
    logToChat: (sender: string, text: string) => Promise<void>;
};
export type WebhookGuardResult = {
    action: "process" | "skip" | "buffer";
    reason?: string;
};
export declare function shouldProcess(adapterName: string, sender: string, wamid: string, text: string, adapters: WebhookGuardAdapters): Promise<WebhookGuardResult>;
export declare function mediaArrived(sender: string): string | null;
export declare function registerWebhookGuard(): void;
export declare function _resetForTest(): void;
//# sourceMappingURL=webhook-guard.d.ts.map
