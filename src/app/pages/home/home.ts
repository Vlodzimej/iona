import { Component } from '@angular/core';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular/standalone';

@Component({
  selector: 'app-home',
  imports: [IonContent, IonHeader, IonTitle, IonToolbar],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {}
