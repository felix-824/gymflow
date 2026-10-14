import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import ReservationSchema from '../../schemas/Reservation.model';

@Module({
	imports: [MongooseModule.forFeature([{ name: 'Reservation', schema: ReservationSchema }])],
})
export class ReservationModule {}
