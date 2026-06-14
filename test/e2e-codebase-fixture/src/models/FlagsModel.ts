export interface FeatureFlag { id: string; name: string; enabled: boolean; targeting?: FlagTargeting; rolloutPercentage?: number }
