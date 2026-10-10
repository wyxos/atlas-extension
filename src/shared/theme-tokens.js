// Atlas dark theme roles, shared by isolated content surfaces. Values match
// the options surface; host pages cannot override tokens inside a shadow root.
export const atlasDarkThemeCss = `:host {
  --background: #00040a; --foreground: #d0d7e5;
  --card: #000b1f; --primary: #0f85fa; --primary-foreground: #ffffff;
  --muted: #1e2737; --muted-foreground: #9ba3b5;
  --border: #33415c; --ring: #0f85fa;
  --destructive: oklch(0.62 0.19 25); --radius: 0.25rem;
}`;
