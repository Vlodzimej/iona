import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'home',
    loadComponent: () => import('./pages/home/home').then((module) => module.Home),
  },
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'home',
  },
];
