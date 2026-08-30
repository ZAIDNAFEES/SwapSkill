interface CapacitorConfig {
  appId: string;
  appName: string;
  webDir: string;
  server?: {
    androidScheme?: string;
  };
  plugins?: {
    GoogleAuth?: {
      scopes?: string[];
      serverClientId?: string;
      forceCodeForRefreshToken?: boolean;
    };
  };
}

const config: CapacitorConfig = {
  appId: 'com.swapskill.app',
  appName: 'SwapSkill',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    GoogleAuth: {
      scopes: ['profile', 'email'],
      serverClientId: '101269763520-resmj9eqouol2ldhmainomj0p5lvvu4e.apps.googleusercontent.com',
      forceCodeForRefreshToken: true
    }
  }
};

export default config;
