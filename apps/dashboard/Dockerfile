FROM nginx:1.25-alpine
WORKDIR /usr/share/nginx/html
RUN echo '<html><head><title>TenantCore Dashboard</title><style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:1rem}.badge{background:#3b82f6;padding:.4rem 1rem;border-radius:9999px;font-size:.875rem}h1{font-size:2.25rem;font-weight:700;background:linear-gradient(135deg,#60a5fa,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent}</style></head><body><h1>TenantCore</h1><span class="badge">Admin Dashboard — React app goes here</span><p style="opacity:.5;font-size:.875rem">Connect your React dashboard app to this container</p></body></html>' > index.html
EXPOSE 80
