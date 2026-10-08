import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Member } from 'apps/gymflow-api/src/libs/dto/member/member';
import { Property } from 'apps/gymflow-api/src/libs/dto/property/property';
import { MemberStatus, MemberType } from 'apps/gymflow-api/src/libs/enums/member.enum';
import { PropertyStatus } from 'apps/gymflow-api/src/libs/enums/property.enum';
import { Model } from 'mongoose';

@Injectable()
export class BatchService {
  constructor(
    @InjectModel('Property') private readonly porpertyModel: Model<Property>,
    @InjectModel('Member') private readonly memberModel: Model<Member>,
  )  {}
  

  public async batchRollback(): Promise<void> {
    await this.porpertyModel.updateMany(
      {
        propertyStatus: PropertyStatus.ACTIVE,
      },
      { propertyRank: 0 },
    )
    .exec();

   await this.memberModel
   .updateMany(
    {
      memberStatus: MemberStatus.ACTIVE,
      memberType: MemberType.AGENT,
    },
    { memberRank: 0 },
   ) 
   .exec();
  }

  // ACTIVE va ranki 0 bo'lgan propertylarning
  // rankini likes va views asosida hisoblab yangilaydi
public async batchTopProperties(): Promise<void> {
	const properties: Property[] = await this.porpertyModel
		.find({
			propertyStatus: PropertyStatus.ACTIVE,
			propertyRank: 0,
		})
		.exec();

	const promisedList = properties.map(async (ele: Property) => {
		const { _id, propertyLikes, propertyViews } = ele;

		const rank = propertyLikes * 2 + propertyViews * 1;

		return await this.porpertyModel.findByIdAndUpdate(_id, {
			propertyRank: rank,
		});
	});

	await Promise.all(promisedList);
}

  // Faol agentlarning rankini faolligi
  // va ko‘rsatkichlari asosida hisoblab yangilaydi
public async batchTopAgents(): Promise<void> {
	const agents: Member[] = await this.memberModel
		.find({
			memberType: MemberType.AGENT,
			memberStatus: MemberStatus.ACTIVE,
			memberRank: 0,
		})
		.exec();

	const promisedList = agents.map(async (ele: Member) => {
		const {
			_id,
			memberProperties,
			memberLikes,
			memberArticles,
			memberViews,
		} = ele;

		const rank =
			memberProperties * 5 +
			memberArticles * 3 +
			memberLikes * 2 +
			memberViews * 1;

		return await this.memberModel.findByIdAndUpdate(_id, {
			memberRank: rank,
		});
	});

	await Promise.all(promisedList);
}

  public getHello(): string {
    return 'Welcome to GymFlow BATCH Server!';
  }

}
