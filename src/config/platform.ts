// Threadsium's platform wallet on Elysium 99901: the single address that receives HYPE for swap and trade
// fees, tips, sends and withdrawals, and Premium payments.
// The swap/send branches define the same address as PLATFORM_FEE_RECIPIENT in src/lib/swap.ts; once they
// merge, swap.ts should import it from here so there is one source of truth.

export const PLATFORM_FEE_RECIPIENT = "0x377A6C8312F1271e70f67F24E2E533FcFdb39810";
