# OCR_and_API
```
DashbordAdmin/
├── .nuxt/                  # Generated Nuxt files
├── components/             # Vue components
│   └── dashboard/
│       ├── Sidebar.vue
│       ├── Header.vue
│       └── StatCards.vue
├── composables/            # Composable functions
│   ├── useAuth.ts         # Authentication logic
│   └── useAdminApi.ts     # API calls
├── layouts/               # Layout templates
│   ├── default.vue        # Default layout
│   └── dashboard.vue      # Admin dashboard layout
├── pages/                 # Vue pages (auto-routing)
│   ├── index.vue         # Root page (/)
│   ├── login.vue         # Login page (/login)
│   └── dashboard/        # Dashboard pages
│       ├── index.vue     # Dashboard home (/dashboard)
│       ├── users/        # User management
│       │   ├── index.vue # Users list
│       │   └── [id].vue  # User detail/edit
│       └── bills/        # Bill management
│           ├── index.vue # Bills list
│           └── [id].vue  # Bill detail
├── public/               # Static files
│   └── images/
├── app.vue              # App root component
├── nuxt.config.ts       # Nuxt configuration
└── package.json         # Project dependencies```
