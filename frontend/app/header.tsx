
import React from 'react';
import { Container, Space, Image, Button, Group, Title} from '@mantine/core';

import { IconBox } from '@tabler/icons-react';


const Header = () => {

  return (
    <Container bg="#202036" fluid w='100vw'>
      <Space h="md" />
        <Group justify="space-between">
          <Group>
            <a style={{"color":"white", "display":'inline'}} href="/"><IconBox/></a>
            <Title style={{"color":"white"}} order={1} textWrap={'pretty'}>ECMWF Forecast In a Box</Title>
          </Group>
          <Group gap='sm' grow preventGrowOverflow={false}>
            <Button radius={0} className="animated-button" bg="rgba(0, 0, 0, 0)" size="md" component='a' href='/'>Home</Button>
            <Button radius={0} className="animated-button" bg="rgba(0, 0, 0, 0)" size="md" component='a' href='/products'>Products</Button>
            <Button radius={0} className="animated-button" bg="rgba(0, 0, 0, 0)" size="md" component='a' href='/status'>Job Status</Button>
          </Group>
        </Group>
      <Space h="md" />
    </Container>
  )
}

export default Header;