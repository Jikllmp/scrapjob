import type { EvidenceDto } from '@scrapjob/schema/api';

export const fieldLabels: Record<string, string> = {
  full_name: 'Full name',
  first_name: 'First name',
  last_name: 'Last name',
  title: 'Title',
  department: 'Department',
  company: 'Employer',
  email: 'Email',
  phone: 'Phone',
  profile_url: 'Profile',
  city: 'City',
  country: 'Country',
  name: 'Name',
  website: 'Website',
  domain: 'Domain',
  industry: 'Industry',
  registry_id: 'Enterprise number',
  generic_email: 'Generic mailbox',
};
export const fieldOrder = ['full_name', 'first_name', 'last_name', 'title', 'department', 'company', 'email', 'phone', 'profile_url', 'city', 'country'];
export const sourceKindLabel: Record<EvidenceDto['sourceKind'], string> = {
  page: 'page read',
  search_snippet: 'search result only',
  dataset: 'open-data record',
};

export const label = (field: string) => fieldLabels[field] ?? field;

