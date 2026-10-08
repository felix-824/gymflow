import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
type ObjectId = Types.ObjectId;
import { View } from '../../libs/dto/view/view';
import { ViewInput } from '../../libs/dto/view/view.input';
import { ViewGroup } from '../../libs/enums/view.enum';
import { OrdinaryInquiry } from '../../libs/dto/common/inquiry';
import { Programs } from '../../libs/dto/program/program';
import { isDuplicateKey } from '../../libs/types/database-error';
import { savedProgramStages } from '../../libs/program.aggregation';

@Injectable()
export class ViewService {
	constructor(@InjectModel('View') private readonly viewModel: Model<View>) {}
	async recordView(input: ViewInput): Promise<View | null> {
		try {
			return await this.viewModel.create(input);
		} catch (error) {
			if (isDuplicateKey(error)) return null;
			throw error;
		}
	}
	async getVisitedPrograms(memberId: ObjectId, input: OrdinaryInquiry): Promise<Programs> {
		const [result] = await this.viewModel
			.aggregate<Programs>(savedProgramStages('view', memberId, input.page, input.limit))
			.exec();
		return result ?? { list: [], metaCounter: [] };
	}
	async removeProgramViews(programId: ObjectId): Promise<void> {
		await this.viewModel.deleteMany({ viewGroup: ViewGroup.PROGRAM, viewRefId: programId }).exec();
	}
}
