"use client"; // Required for client-side fetching

import { Card, Button, Tabs, Stack, Paper, Text } from '@mantine/core';
import { useEffect, useState } from "react";

import classes from './categories.module.css';

import {CategoriesInterface} from './interface'

interface CategoriesProps {
    categories: CategoriesInterface;
    setSelected: (value: string) => void;
}

function Categories({categories, setSelected }: CategoriesProps) {

    return (
        <>
        {Object.entries(categories).map(([key, item]) => (
            <Paper shadow='sm' className={classes['option-group']} key={key} m='md' p='sm' ml=''>
                <Text className={classes['heading']}>{item.title}</Text>
                <Text className={classes['description']}>{item.description}</Text>
                {item.options.map((option, idx) => (
                    <Button key={idx} p='' className={classes['button']} onClick={() => setSelected(`${key}/${option}`)}>
                        {option}
                    </Button>
                ))}
            </Paper>
        ))}
        </>
    );
}

export default Categories;
