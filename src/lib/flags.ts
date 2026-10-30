/**
 * Google Play build (`VITE_STORE_BUILD=play`).
 *
 * Play's Payments policy forbids steering users to an outside payment for
 * content that unlocks inside the app. Partner access is sold on Telegram, so
 * the Play build never mentions how to obtain it and never links to Telegram —
 * Partners simply sign in. Website, Instagram and e-mail links stay.
 */
export const IS_PLAY_BUILD = import.meta.env.VITE_STORE_BUILD === 'play';
