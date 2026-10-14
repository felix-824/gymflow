import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import ReservationSchema from '../../schemas/Reservation.model';
import MemberSchema from '../../schemas/Member.model';
import ProgramSchema from '../../schemas/Program.model';
import TrainerScheduleSchema from '../../schemas/TrainerSchedule.model';
import { AuthModule } from '../auth/auth.module';
import { ReservationResolver } from './reservation.resolver';
import { ReservationService } from './reservation.service';

@Module({
	imports: [
		AuthModule,
		MongooseModule.forFeature([
			{ name: 'Reservation', schema: ReservationSchema },
			{ name: 'Member', schema: MemberSchema },
			{ name: 'Program', schema: ProgramSchema },
			{ name: 'TrainerSchedule', schema: TrainerScheduleSchema },
		]),
	],
	providers: [ReservationResolver, ReservationService],
})
export class ReservationModule {}
