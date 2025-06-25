// Remove the entire block
// declare module 'googleapis' {
//   export const google: {
//     sheets: (options: { version: string; auth: any }) => {
//       spreadsheets: {
//         values: {
//           get: (params: {
//             spreadsheetId: string;
//             range: string;
//           }) => Promise<{
//             data: {
//               values: string[][];
//             };
//           }>;
//         };
//       };
//     };
//     auth: {
//       GoogleAuth: new (options: {
//         keyFile: string;
//         scopes: string[];
//       }) => any;
//     };
//   };
// }

// Environment variables
declare namespace NodeJS {
  interface ProcessEnv {
    DISCORD_TOKEN: string;
    RAID_CHANNEL_ID: string;
    INVENTORY_CHANNEL_ID: string;
    SUGGESTIONS_CHANNEL_ID: string;
    SUGGESTIONS_SHEET_ID: string;
    GITHUB_TOKEN: string;
    GITHUB_REPO: string;
    RAID_FILE_PATH: string;
    GITHUB_BRANCH?: string;
    GOOGLE_CALENDAR_ID: string;
  }
} 