'use client';
import React, { useState, useEffect, useRef } from "react";

import { Container, Title, Center, Space, Button, Group, Divider, Image } from "@mantine/core";

import { IconCube, IconStack2Filled, IconBlocks, IconMapPin, IconTable, IconPolygon, IconBraces, IconWorld } from "@tabler/icons-react";

const Packages = () => {


  return (
    <Container fluid bg="#3F3F6B">
      <Divider color="#fff" />
      <Container size="lg">
        <Space h="xl" />
        <Space h="xl" />
        <Center>
            <Title style={{color: "white"}} size={40}>Building on top of</Title>
        </Center>
        <Space h="xl" />
        <Group gap={0} justify="space-evenly">
          <Image src="logos/packages/earthkit-dark.svg" w={240} style={{ paddingTop: "5px" }} />
          <Image src="logos/packages/anemoi.webp" w={240} style={{ paddingTop: "12px" }} />
        </Group>
        <Space h="xl" />
        <Space h="xl" />
      </Container>
    </Container>
  )
};

export default Packages;