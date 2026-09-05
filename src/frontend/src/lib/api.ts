const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export interface ApiMeta {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export interface ApiResponse<T> {
  data: T;
  meta?: ApiMeta;
}

export interface ApiError {
  error: { code: string; message: string; details: unknown[] };
}

class ApiClient {
  private token: string | null = null;
  private customerToken: string | null = null;

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem("token", token);
    } else {
      localStorage.removeItem("token");
    }
  }

  getToken(): string | null {
    if (!this.token) {
      this.token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    }
    return this.token;
  }

  setCustomerToken(token: string | null) {
    this.customerToken = token;
    if (token) {
      localStorage.setItem("customer_token", token);
    } else {
      localStorage.removeItem("customer_token");
    }
  }

  getCustomerToken(): string | null {
    if (!this.customerToken) {
      this.customerToken = typeof window !== "undefined" ? localStorage.getItem("customer_token") : null;
    }
    return this.customerToken;
  }

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) || {}),
    };

    const isPortalPath = path.startsWith("/api/v1/portal");
    const activeToken = isPortalPath ? this.getCustomerToken() : this.getToken();

    if (activeToken) {
      headers["Authorization"] = `Bearer ${activeToken}`;
    }

    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

    if (!res.ok) {
      const error: ApiError = await res.json();
      throw new Error(error.error?.message || `API error ${res.status}`);
    }

    return res.json();
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = params ? `${path}?${new URLSearchParams(params).toString()}` : path;
    return this.request<T>(url);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  async login(email: string, password: string) {
    const res = await this.post<ApiResponse<{
      access_token: string;
      refresh_token: string;
      user: { id: number; email: string; role_id: number; role_name: string };
    }>>("/api/v1/auth/login", { email, password });

    this.setToken(res.data.access_token);
    localStorage.setItem("refresh_token", res.data.refresh_token);
    localStorage.setItem("user", JSON.stringify(res.data.user));
    return res.data;
  }

  async customerLogin(email: string, password: string) {
    const res = await this.post<ApiResponse<{
      token: string;
      customer: { id: number; name: string; email: string; company: string | null; status: string; currency_code: string; tier_name: string };
    }>>("/api/v1/auth/customer/login", { email, password });

    this.setCustomerToken(res.data.token);
    localStorage.setItem("customer_info", JSON.stringify(res.data.customer));
    return res.data;
  }

  async customerSetupPassword(setupToken: string, password: string) {
    const res = await this.post<ApiResponse<{
      token: string;
      customer: { id: number; name: string; email: string; company: string | null; status: string; currency_code: string; tier_name: string };
    }>>("/api/v1/auth/customer/setup-password", { setup_token: setupToken, password });

    this.setCustomerToken(res.data.token);
    localStorage.setItem("customer_info", JSON.stringify(res.data.customer));
    return res.data;
  }

  logout() {
    this.setToken(null);
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("user");
  }

  customerLogout() {
    this.setCustomerToken(null);
    localStorage.removeItem("customer_info");
  }
}

export const api = new ApiClient();
