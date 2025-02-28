
import { NextRequest } from "next/server";
 

const sampleData = {
  parameters:  {
    label: 'Parameters',
    description: 'GRIB ShortNames',
    values: ['t', 'u', 'v', 'w', '2t', 'msl']
  },
  level: {
    label: 'Level',
    description: 'Mars Formatted Step Range',
    values: ['1000', '800', '700', '600', '500', '400']
  },
  steps: {
    label: 'Step Range',
    description: 'Mars Formatted Step Range',
    example: '24/to/48'
  } 
}

const sampleData2 = {
  forecast: {
    label: 'Forecast',
    description: 'Random Forecast Data',
    values: ['sunny', 'rainy', 'cloudy']
  },
  temperature: {
    label: 'Temperature',
    description: 'Random Temperature Data',
    values: ['20°C', '25°C', '30°C'],
    multiple: true
  },
  humidity: {
    label: 'Humidity',
    description: 'Random Humidity Data',
    values: ['50%', '60%', '70%']
  },
  wind: {
    label: 'Wind',
    description: 'Random Wind Data',
    values: ['5 km/h', '10 km/h', '15 km/h']
  },
  pressure: {
    label: 'Pressure',
    description: 'Random Pressure Data',
    values: []
  }
}

export async function POST(req: NextRequest, { params }: { params: { product: string } }) {
  const { product } = await params;
  const body = await req.json(); // Parse JSON body

  console.log('body', body);

  const responseData = product === 'EFI' ? sampleData2 : sampleData;
  responseData['product'] = {
    label: "Test",
    description: 'Product Description',
    example: JSON.stringify(body)
  };
  // responseData.level ? re÷sponseData.level.values = [`product/${body.level}`, 'product2', 'product3', 'product4', 'product5'] : null;
  return Response.json(responseData);
}
