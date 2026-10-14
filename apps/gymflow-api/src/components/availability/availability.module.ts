import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import ReservationSchema from '../../schemas/Reservation.model';
import { AuthModule } from '../auth/auth.module';
import { ProgramModule } from '../program/program.module';
import { TrainerScheduleModule } from '../trainer-schedule/trainer-schedule.module';
import { AvailabilityResolver } from './availability.resolver';
import { AvailabilityService } from './availability.service';

@Module({
	imports: [
		AuthModule,
		ProgramModule,
		TrainerScheduleModule,
		MongooseModule.forFeature([{ name: 'Reservation', schema: ReservationSchema }]),
	],
	providers: [AvailabilityResolver, AvailabilityService],
	exports: [AvailabilityService],
})
export class AvailabilityModule {}
