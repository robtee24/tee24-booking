// lib/session.ts
// CLIENT-SAFE: No prisma, no global, no server-only imports

export type AdminSession = {
  sub: string;
  role: "ROOT" | "FULL" | "SCOPED";
};

// These will be re-exported from server file in server contexts
export const setAdminSession = async () => { throw new Error("setAdminSession is server-only"); };
export const clearAdminSession = async () => { throw new Error("clearAdminSession is server-only"); };
export const getAdminSession = async (): Promise<null> => null;

export const isRoot = () => false;
export const hasFullAccess = () => false;