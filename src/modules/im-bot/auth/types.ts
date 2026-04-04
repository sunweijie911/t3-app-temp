export interface TokenManager {
  getToken(): Promise<string>;
}
